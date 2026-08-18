import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, desc, eq } from "drizzle-orm";
import type { NotificationDto } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../database/database.module";
import { notifications } from "../../database/schema";

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

/** Every query here is scoped to the caller's own userId — see docs/decisions/0009-notifications-phase9-scope.md. */
@Injectable()
export class NotificationsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async create(organizationId: string, userId: string, input: CreateNotificationInput) {
    await this.db.insert(notifications).values({ organizationId, userId, ...input });
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
}
