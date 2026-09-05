import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, count, desc, eq } from "drizzle-orm";
import type { ApiEnv } from "@sales-platform/config";
import type { NotificationDto, NotificationEmailDeliveryMode, NotificationPreferencesDto } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../database/database.module";
import { notifications, notificationPreferences, users } from "../../database/schema";
import { MailerService } from "../../shared/mail/mailer.service";

export interface CreateNotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
}

function serialize(row: typeof notifications.$inferSelect): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    isRead: row.isRead,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Every query here is scoped to the caller's own userId — see
 * docs/decisions/0009-notifications-phase9-scope.md. Delivery-preference-
 * aware email dispatch on `create()` was added in Phase 19 — see
 * docs/decisions/0019-notification-preferences-phase19-scope.md.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly webAppUrl: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly mailer: MailerService,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.webAppUrl = config.get("WEB_APP_URL", { infer: true });
  }

  async create(organizationId: string, userId: string, input: CreateNotificationInput) {
    await this.db.insert(notifications).values({ organizationId, userId, ...input });

    // Deliberately not awaited: NotificationsListener.notify() awaits
    // create() in full, and create()'s caller (a fire-and-forget
    // EventEmitter2 listener — see DomainEventBus.publish()) is itself
    // racing against whatever HTTP response triggered the event. Before
    // this preference-check/email step existed, create() resolved as soon
    // as the insert above did; making the (already best-effort,
    // try/catch-guarded) email dispatch non-blocking here preserves that
    // exact timing for every caller instead of adding a second DB round
    // trip's worth of latency to every single notification created,
    // including the overwhelming default "off" case that never sends mail.
    void this.dispatchImmediateEmail(organizationId, userId, input);
  }

  private async dispatchImmediateEmail(organizationId: string, userId: string, input: CreateNotificationInput): Promise<void> {
    try {
      const preferences = await this.getPreferences(organizationId, userId);
      if (preferences.emailDelivery !== "immediate") return;

      const [recipient] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
      if (!recipient) return;

      const link = input.link ? `${this.webAppUrl}${input.link}` : this.webAppUrl;
      await this.mailer.send({
        to: recipient.email,
        subject: input.title,
        html: `<p>${input.title}</p>${input.body ? `<p>${input.body}</p>` : ""}<p><a href="${link}">View in the app</a></p>`,
        text: `${input.title}${input.body ? `\n\n${input.body}` : ""}\n\n${link}`,
      });
    } catch (error) {
      // Same best-effort posture as MailListener/AuditListener: a failed
      // delivery email must never break the in-app notification that was
      // already created above.
      this.logger.error(`Failed to send immediate delivery email for notification type "${input.type}"`, error as Error);
    }
  }

  async list(organizationId: string, userId: string, options: { unreadOnly?: boolean } = {}): Promise<NotificationDto[]> {
    const conditions = [eq(notifications.organizationId, organizationId), eq(notifications.userId, userId)];
    if (options.unreadOnly) conditions.push(eq(notifications.isRead, false));

    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    return rows.map(serialize);
  }

  async unreadCount(organizationId: string, userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.organizationId, organizationId), eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return row?.count ?? 0;
  }

  async markRead(organizationId: string, userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notifications.organizationId, organizationId), eq(notifications.userId, userId), eq(notifications.id, id)))
      .returning({ id: notifications.id });
    if (!row) throw new NotFoundException(`Notification ${id} not found`);
  }

  async markAllRead(organizationId: string, userId: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notifications.organizationId, organizationId), eq(notifications.userId, userId), eq(notifications.isRead, false)));
  }

  /** No row yet means the user never opted in — "off" is the safe, byte-for-byte-today default. */
  async getPreferences(organizationId: string, userId: string): Promise<NotificationPreferencesDto> {
    const [row] = await this.db
      .select({ emailDelivery: notificationPreferences.emailDelivery })
      .from(notificationPreferences)
      .where(and(eq(notificationPreferences.organizationId, organizationId), eq(notificationPreferences.userId, userId)))
      .limit(1);
    return { emailDelivery: (row?.emailDelivery as NotificationEmailDeliveryMode | undefined) ?? "off" };
  }

  async setPreferences(organizationId: string, userId: string, input: NotificationPreferencesDto): Promise<void> {
    await this.db
      .insert(notificationPreferences)
      .values({ organizationId, userId, emailDelivery: input.emailDelivery })
      .onConflictDoUpdate({
        target: [notificationPreferences.organizationId, notificationPreferences.userId],
        set: { emailDelivery: input.emailDelivery, updatedAt: new Date() },
      });
  }
}
