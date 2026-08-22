import { randomUUID } from "node:crypto";
import { index, integer, numeric, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
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

export const DUNNING_CYCLE_STATUSES = ["waiting", "attempting", "succeeded", "exhausted"] as const;

/**
 * Tracks a subscription's dunning process regardless of which
 * WORKFLOW_ENGINE backend is orchestrating the wait/retry — see
 * docs/decisions/0016-temporal-dunning-phase16-scope.md. `nextAttemptAt` is
 * only meaningful for the in-process (Postgres cron) backend; the Temporal
 * backend tracks its own timers and leaves it null. DunningListener reads
 * this table (regardless of backend) to decide whether a `payment.failed`
 * event starts a new cycle or reports the outcome of an existing one.
 */
export const dunningCycles = paymentsSchema.table(
  "dunning_cycles",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
    latestPaymentId: uuid("latest_payment_id").references(() => payments.id, { onDelete: "set null" }),
    attemptNumber: integer("attempt_number").notNull().default(1),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    // DUNNING_CYCLE_STATUSES
    status: text("status").notNull().default("waiting"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index("dunning_cycles_org_idx").on(table.organizationId),
    // Scheduler's polling query (in-process backend only): WHERE status = 'waiting' AND next_attempt_at <= now().
    pendingIdx: index("dunning_cycles_pending_idx").on(table.status, table.nextAttemptAt),
    // Only one active (waiting/attempting) cycle per subscription at a time.
    activeSubscriptionUnique: uniqueIndex("dunning_cycles_active_subscription_unique")
      .on(table.subscriptionId)
      .where(sql`${table.status} in ('waiting', 'attempting')`),
  }),
);

export const dunningCyclesRelations = relations(dunningCycles, ({ one }) => ({
  organization: one(organizations, { fields: [dunningCycles.organizationId], references: [organizations.id] }),
  subscription: one(subscriptions, { fields: [dunningCycles.subscriptionId], references: [subscriptions.id] }),
  latestPayment: one(payments, { fields: [dunningCycles.latestPaymentId], references: [payments.id] }),
}));
