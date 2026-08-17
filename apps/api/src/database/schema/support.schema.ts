import { randomUUID } from "node:crypto";
import { boolean, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { isNull, relations } from "drizzle-orm";
import { organizations, users } from "./identity.schema";
import { accounts, contacts } from "./crm.schema";

/**
 * One Postgres schema per domain module (see docs/architecture/overview.md).
 * The `support` module owns everything under the `support` schema; no other
 * module may reference these tables directly. The one exception is the FKs
 * below to `crm.accounts`/`crm.contacts` and `identity.users` — a foreign
 * key, not a cross-module query, same accepted pattern as `sales.schema.ts`.
 */
export const supportSchema = pgSchema("support");

export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export const slaPolicies = supportSchema.table(
  "sla_policies",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // TICKET_PRIORITIES — one policy per organization+priority (see orgPriorityUnique).
    priority: text("priority").notNull(),
    firstResponseTargetMinutes: integer("first_response_target_minutes").notNull(),
    resolutionTargetMinutes: integer("resolution_target_minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("sla_policies_org_idx").on(table.organizationId),
    // Partial: only live (non-soft-deleted) policies compete for a priority
    // slot, so deleting one and adding a replacement for the same priority
    // is always possible.
    orgPriorityUnique: uniqueIndex("sla_policies_org_priority_unique")
      .on(table.organizationId, table.priority)
      .where(isNull(table.deletedAt)),
  }),
);

export const tickets = supportSchema.table(
  "tickets",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    description: text("description"),
    // TICKET_STATUSES
    status: text("status").notNull().default("open"),
    // TICKET_PRIORITIES
    priority: text("priority").notNull().default("medium"),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    slaPolicyId: uuid("sla_policy_id").references(() => slaPolicies.id, { onDelete: "set null" }),
    // Snapshotted from the matching SLA policy at creation time — a later
    // edit to the policy never changes an already-created ticket's due
    // dates (same "snapshot, not live reference" reasoning as quote line
    // items — see docs/decisions/0006-support-phase6-scope.md).
    firstResponseDueAt: timestamp("first_response_due_at", { withTimezone: true }),
    resolutionDueAt: timestamp("resolution_due_at", { withTimezone: true }),
    firstRespondedAt: timestamp("first_responded_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("tickets_org_idx").on(table.organizationId),
    orgStatusIdx: index("tickets_org_status_idx").on(table.organizationId, table.status),
    accountIdx: index("tickets_account_idx").on(table.accountId),
    assigneeIdx: index("tickets_assignee_idx").on(table.assigneeId),
  }),
);

export const ticketComments = supportSchema.table(
  "ticket_comments",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    // Public comments notify the ticket's contact by email; internal notes
    // (isPublic: false) never do — see MailListener.
    isPublic: boolean("is_public").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ticketIdx: index("ticket_comments_ticket_idx").on(table.ticketId, table.createdAt),
  }),
);

export const kbArticles = supportSchema.table(
  "kb_articles",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // Globally unique, not per-org — same "simplest race-free, global"
    // trade-off as quote numbering (ADR 0005).
    slug: text("slug").notNull().unique(),
    category: text("category"),
    body: text("body").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    isPublished: boolean("is_published").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("kb_articles_org_idx").on(table.organizationId),
    slugIdx: index("kb_articles_slug_idx").on(table.slug),
  }),
);

export const slaPoliciesRelations = relations(slaPolicies, ({ one, many }) => ({
  organization: one(organizations, { fields: [slaPolicies.organizationId], references: [organizations.id] }),
  tickets: many(tickets),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  organization: one(organizations, { fields: [tickets.organizationId], references: [organizations.id] }),
  account: one(accounts, { fields: [tickets.accountId], references: [accounts.id] }),
  contact: one(contacts, { fields: [tickets.contactId], references: [contacts.id] }),
  assignee: one(users, { fields: [tickets.assigneeId], references: [users.id] }),
  slaPolicy: one(slaPolicies, { fields: [tickets.slaPolicyId], references: [slaPolicies.id] }),
  comments: many(ticketComments),
}));

export const ticketCommentsRelations = relations(ticketComments, ({ one }) => ({
  organization: one(organizations, { fields: [ticketComments.organizationId], references: [organizations.id] }),
  ticket: one(tickets, { fields: [ticketComments.ticketId], references: [tickets.id] }),
  author: one(users, { fields: [ticketComments.authorId], references: [users.id] }),
}));

export const kbArticlesRelations = relations(kbArticles, ({ one }) => ({
  organization: one(organizations, { fields: [kbArticles.organizationId], references: [organizations.id] }),
}));
