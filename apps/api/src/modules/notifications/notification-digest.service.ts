import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { ApiEnv } from "@sales-platform/config";
import { DATABASE_CONNECTION, type Database } from "../../database/database.module";
import { notifications, notificationPreferences, users } from "../../database/schema";
import { MailerService } from "../../shared/mail/mailer.service";

interface DigestRow {
  notificationId: string;
  userId: string;
  email: string;
  title: string;
  link: string | null;
}

/**
 * Batches undigested notifications for every user whose
 * `notificationPreferences.emailDelivery` is `"daily_digest"` into one email
 * per user, once a day, then stamps `digestSentAt` so the same notification
 * is never included twice. See
 * docs/decisions/0019-notification-preferences-phase19-scope.md. A separate
 * service from `NotificationsService` — same "scheduled batch job gets its
 * own service" split as `RenewalsService`/`DunningActionsService`.
 */
@Injectable()
export class NotificationDigestService {
  private readonly logger = new Logger(NotificationDigestService.name);
  private readonly webAppUrl: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly mailer: MailerService,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.webAppUrl = config.get("WEB_APP_URL", { infer: true });
  }

  /** Returns how many users' digests were sent — used by tests, ignored by the scheduler. */
  async sendDueDigests(): Promise<number> {
    const rows: DigestRow[] = await this.db
      .select({
        notificationId: notifications.id,
        userId: notifications.userId,
        email: users.email,
        title: notifications.title,
        link: notifications.link,
      })
      .from(notifications)
      .innerJoin(
        notificationPreferences,
        and(eq(notifications.organizationId, notificationPreferences.organizationId), eq(notifications.userId, notificationPreferences.userId)),
      )
      .innerJoin(users, eq(notifications.userId, users.id))
      .where(and(eq(notificationPreferences.emailDelivery, "daily_digest"), isNull(notifications.digestSentAt)));

    const byUser = new Map<string, { email: string; items: { title: string; link: string | null }[]; ids: string[] }>();
    for (const row of rows) {
      const group = byUser.get(row.userId) ?? { email: row.email, items: [], ids: [] };
      group.items.push({ title: row.title, link: row.link });
      group.ids.push(row.notificationId);
      byUser.set(row.userId, group);
    }

    let sent = 0;
    for (const [userId, group] of byUser) {
      try {
        await this.sendDigestEmail(group.email, group.items);
        await this.db.update(notifications).set({ digestSentAt: new Date() }).where(inArray(notifications.id, group.ids));
        sent++;
      } catch (error) {
        // One user's failed send/update must not stop the rest of the batch
        // — same "swallow and continue" shape as DunningScheduler.processDueCycles().
        this.logger.error(`Failed to send notification digest for user "${userId}"`, error as Error);
      }
    }
    return sent;
  }

  private async sendDigestEmail(email: string, items: { title: string; link: string | null }[]): Promise<void> {
    const rows = items.map((item) => ({ ...item, url: item.link ? `${this.webAppUrl}${item.link}` : this.webAppUrl }));
    const html = `<p>Here's what you missed:</p><ul>${rows.map((r) => `<li><a href="${r.url}">${r.title}</a></li>`).join("")}</ul>`;
    const text = `Here's what you missed:\n\n${rows.map((r) => `- ${r.title}: ${r.url}`).join("\n")}`;
    await this.mailer.send({ to: email, subject: "Your daily notification digest", html, text });
  }
}
