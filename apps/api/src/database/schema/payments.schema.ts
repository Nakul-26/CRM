import { randomUUID } from "node:crypto";
import { index, numeric, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations } from "./identity.schema";
import { subscriptions } from "./subscriptions.schema";

/**
 * One Postgres schema per domain module (see docs/architecture/overview.md).
 * `subscriptionId` is NOT NULL — this phase's only purpose is subscription
 * renewal (see docs/decisions/0013-payment-processing-phase13-scope.md).
 */
export const paymentsSchema = pgSchema("payments");

export const PAYMENT_STATUSES = ["pending", "succeeded", "failed"] as const;
export const PAYMENT_PROVIDERS = ["mock", "stripe"] as const;

export const payments = paymentsSchema.table(
  "payments",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("usd"),
    // Snapshotted at checkout start (e.g. "Renewal — Pro") so the public mock
    // checkout view never needs to join subscriptions/plans.
    description: text("description").notNull(),
    // PAYMENT_STATUSES
    status: text("status").notNull().default("pending"),
    // PAYMENT_PROVIDERS
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    failureReason: text("failure_reason"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("payments_org_idx").on(table.organizationId),
    subscriptionIdx: index("payments_subscription_idx").on(table.subscriptionId),
  }),
);

export const paymentsRelations = relations(payments, ({ one }) => ({
  organization: one(organizations, { fields: [payments.organizationId], references: [organizations.id] }),
  subscription: one(subscriptions, { fields: [payments.subscriptionId], references: [subscriptions.id] }),
}));
