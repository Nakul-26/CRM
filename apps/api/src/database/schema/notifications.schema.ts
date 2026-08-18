import { randomUUID } from "node:crypto";
import { boolean, index, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations, users } from "./identity.schema";

/**
 * One Postgres schema per domain module (see docs/architecture/overview.md).
 * The `notifications` module owns everything under the `notifications`
 * schema; no other module may reference this table directly. Rows are
 * system-generated only (by `NotificationsListener`, never a user), so
 * there's no `createdBy`/`updatedBy`/`deletedAt` audit-column set — same
 * reasoning `renewal_reminders` used for its job-table rows in Phase 7.
 */
export const notificationsSchema = pgSchema("notifications");

export const notifications = notificationsSchema.table(
  "notifications",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // the source DomainEvent's eventType, e.g. "ticket.assigned"
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("notifications_user_idx").on(table.organizationId, table.userId, table.createdAt),
    unreadIdx: index("notifications_unread_idx").on(table.userId, table.isRead),
  }),
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  organization: one(organizations, { fields: [notifications.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));
