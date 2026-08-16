import { randomUUID } from "node:crypto";
import { boolean, index, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations, users } from "./identity.schema";
import { accounts, contacts } from "./crm.schema";

/**
 * One Postgres schema per domain module (see docs/architecture/overview.md).
 * The `sales` module owns everything under the `sales` schema; no other
 * module may reference these tables directly. The one exception is the FKs
 * below to `crm.accounts`/`crm.contacts` — a foreign key, not a
 * cross-module query, same accepted pattern as `leads.schema.ts`.
 */
export const salesSchema = pgSchema("sales");

export const OPPORTUNITY_OUTCOMES = ["open", "won", "lost"] as const;

export const pipelines = salesSchema.table(
  "pipelines",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("pipelines_org_idx").on(table.organizationId),
  }),
);

export const stages = salesSchema.table(
  "stages",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    order: integer("order").notNull(),
    probability: integer("probability").notNull().default(0),
    isWon: boolean("is_won").notNull().default(false),
    isLost: boolean("is_lost").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pipelineOrderIdx: index("stages_pipeline_order_idx").on(table.pipelineId, table.order),
  }),
);

export const opportunities = salesSchema.table(
  "opportunities",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    pipelineId: uuid("pipeline_id").notNull().references(() => pipelines.id),
    stageId: uuid("stage_id").notNull().references(() => stages.id),
    // OPPORTUNITY_OUTCOMES — denormalized from the current stage's isWon/isLost
    // flags so analytics queries don't need a stages join.
    outcome: text("outcome").notNull().default("open"),
    value: numeric("value", { precision: 12, scale: 2 }),
    currency: text("currency"),
    probability: integer("probability").notNull().default(0),
    expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // LEAD_SOURCES, reused — same channel list applies to where a deal originated.
    source: text("source"),
    competitors: jsonb("competitors").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("opportunities_org_idx").on(table.organizationId),
    orgOutcomeIdx: index("opportunities_org_outcome_idx").on(table.organizationId, table.outcome),
    accountIdx: index("opportunities_account_idx").on(table.accountId),
    pipelineStageIdx: index("opportunities_pipeline_stage_idx").on(table.pipelineId, table.stageId),
  }),
);

export const pipelinesRelations = relations(pipelines, ({ one, many }) => ({
  organization: one(organizations, { fields: [pipelines.organizationId], references: [organizations.id] }),
  stages: many(stages),
}));

export const stagesRelations = relations(stages, ({ one }) => ({
  organization: one(organizations, { fields: [stages.organizationId], references: [organizations.id] }),
  pipeline: one(pipelines, { fields: [stages.pipelineId], references: [pipelines.id] }),
}));

export const opportunitiesRelations = relations(opportunities, ({ one }) => ({
  organization: one(organizations, { fields: [opportunities.organizationId], references: [organizations.id] }),
  account: one(accounts, { fields: [opportunities.accountId], references: [accounts.id] }),
  contact: one(contacts, { fields: [opportunities.contactId], references: [contacts.id] }),
  owner: one(users, { fields: [opportunities.ownerId], references: [users.id] }),
  pipeline: one(pipelines, { fields: [opportunities.pipelineId], references: [pipelines.id] }),
  stage: one(stages, { fields: [opportunities.stageId], references: [stages.id] }),
}));
