import { randomUUID } from "node:crypto";
import { boolean, index, numeric, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { isNull, relations } from "drizzle-orm";
import { organizations } from "./identity.schema";
import { accounts, contacts } from "./crm.schema";

/**
 * One Postgres schema per domain module (see docs/architecture/overview.md).
 * The `subscriptions` module owns everything under the `subscriptions`
 * schema; no other module may reference these tables directly. The one
 * exception is the FKs below to `crm.accounts`/`crm.contacts` — a foreign
 * key, not a cross-module query, same accepted pattern as `support.schema.ts`.
 */
export const subscriptionsSchema = pgSchema("subscriptions");

export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export const SUBSCRIPTION_STATUSES = ["active", "lapsed", "cancelled"] as const;

export const plans = subscriptionsSchema.table(
  "plans",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    // BILLING_INTERVALS
    billingInterval: text("billing_interval").notNull().default("monthly"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("plans_org_idx").on(table.organizationId),
    // Partial: only live (non-soft-deleted) plans compete for a name slot,
    // so deleting one and adding a replacement with the same name is always
    // possible (same shape as sla_policies_org_priority_unique).
    orgNameUnique: uniqueIndex("plans_org_name_unique")
      .on(table.organizationId, table.name)
      .where(isNull(table.deletedAt)),
  }),
);

export const subscriptions = subscriptionsSchema.table(
  "subscriptions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
    // Snapshotted from the plan at creation time — a later edit to the plan
    // never changes an already-created subscription's rate (same "snapshot,
    // not live reference" reasoning as quote line items / ticket SLA
    // due-dates — see docs/decisions/0007-subscriptions-phase7-scope.md).
    planName: text("plan_name").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    billingInterval: text("billing_interval").notNull(),
    // SUBSCRIPTION_STATUSES
    status: text("status").notNull().default("active"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("subscriptions_org_idx").on(table.organizationId),
    orgStatusIdx: index("subscriptions_org_status_idx").on(table.organizationId, table.status),
    accountIdx: index("subscriptions_account_idx").on(table.accountId),
    periodEndIdx: index("subscriptions_period_end_idx").on(table.currentPeriodEnd),
  }),
);

export const renewalReminders = subscriptionsSchema.table(
  "renewal_reminders",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
    remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subIdx: index("renewal_reminders_subscription_idx").on(table.subscriptionId),
    // Scheduler's polling query: WHERE remind_at <= now() AND sent_at IS NULL.
    pendingIdx: index("renewal_reminders_pending_idx").on(table.remindAt, table.sentAt),
  }),
);

export const plansRelations = relations(plans, ({ one, many }) => ({
  organization: one(organizations, { fields: [plans.organizationId], references: [organizations.id] }),
  subscriptions: many(subscriptions),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  organization: one(organizations, { fields: [subscriptions.organizationId], references: [organizations.id] }),
  account: one(accounts, { fields: [subscriptions.accountId], references: [accounts.id] }),
  contact: one(contacts, { fields: [subscriptions.contactId], references: [contacts.id] }),
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
  renewalReminders: many(renewalReminders),
}));

export const renewalRemindersRelations = relations(renewalReminders, ({ one }) => ({
  organization: one(organizations, { fields: [renewalReminders.organizationId], references: [organizations.id] }),
  subscription: one(subscriptions, { fields: [renewalReminders.subscriptionId], references: [subscriptions.id] }),
}));
