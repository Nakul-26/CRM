import { randomUUID } from "node:crypto";
import { boolean, index, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    // Set once this row has been included in a sent daily-digest email (see
    // docs/decisions/0019-notification-preferences-phase19-scope.md) — null
    // until then. Independent of isRead/readAt: a digested notification can
    // still be unread in-app, and vice versa. Only ever set for recipients
    // whose notificationPreferences.emailDelivery is "daily_digest"; rows
    // for "off"/"immediate" recipients simply never get stamped.
    digestSentAt: timestamp("digest_sent_at", { withTimezone: true }),
  },
  (table) => ({
    userIdx: index("notifications_user_idx").on(table.organizationId, table.userId, table.createdAt),
    unreadIdx: index("notifications_unread_idx").on(table.userId, table.isRead),
  }),
);

/**
 * One row per user, created lazily on first `PUT /notifications/preferences`
 * — a user who never visits notification settings simply has no row here,
 * and `NotificationsService.getPreferences` reports the "off" default for
 * them. See docs/decisions/0019-notification-preferences-phase19-scope.md.
 * `emailDelivery` is a plain string column, not a Postgres enum — same
 * convention as every other status-like column in this codebase (e.g.
 * `tickets.status`, `quotes.status`); the allowed values are enforced at
 * the Zod layer (`packages/contracts/src/notifications.ts`).
 */
export const notificationPreferences = notificationsSchema.table(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // "off" | "immediate" | "daily_digest" — see NotificationEmailDeliveryMode.
    emailDelivery: text("email_delivery").notNull().default("off"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // The onConflictDoUpdate target for the upsert in setPreferences(), and
    // what makes "one row per user" an actual DB-enforced invariant rather
    // than just an application convention.
    orgUserUnique: uniqueIndex("notification_preferences_org_user_unique").on(table.organizationId, table.userId),
  }),
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  organization: one(organizations, { fields: [notifications.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  organization: one(organizations, { fields: [notificationPreferences.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [notificationPreferences.userId], references: [users.id] }),
}));
