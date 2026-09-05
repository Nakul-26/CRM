import { randomUUID } from "node:crypto";
import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Ported from apps/api/src/database/schema/notifications.schema.ts (Phase
 * 18's microservices split — see
 * docs/decisions/0018-microservices-split-phase18-scope.md). Two
 * differences from the monolith's version, both forced by this table now
 * living in its own database:
 *  - No `pgSchema("notifications")` wrapper — this database has exactly one
 *    schema-owning module, so the default `public` schema is fine; there's
 *    no sibling module to namespace away from.
 *  - No `.references()` FK constraints to `organizations`/`users` — those
 *    tables live in apps/api's database now, and Postgres has no
 *    cross-database foreign keys. `organizationId`/`userId` are trusted the
 *    same way `audit_log.organizationId`/`actorId` already are in the
 *    monolith today: populated from a verified JWT's claims, never a raw
 *    client input.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
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
