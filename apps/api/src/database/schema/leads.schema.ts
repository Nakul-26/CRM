import { randomUUID } from "node:crypto";
import { boolean, index, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations, users } from "./identity.schema";
import { accounts, contacts } from "./crm.schema";

/**
 * One Postgres schema per domain module (see docs/architecture/overview.md).
 * The `leads` module owns everything under the `leads` schema; no other
 * module may reference these tables directly. The one exception is the FKs
 * below to `crm.accounts`/`crm.contacts` recording where a lead converted
 * to — a foreign key, not a cross-module query.
 */
export const leadsSchema = pgSchema("leads");

export const LEAD_SOURCES = [
  "website",
  "referral",
  "advertisement",
  "linkedin",
  "cold_outreach",
  "event",
  "import",
  "api",
  "partner",
] as const;

export const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Unqualified", "Converted"] as const;

export const leads = leadsSchema.table(
  "leads",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    company: text("company"),
    email: text("email"),
    phone: text("phone"),
    // LEAD_SOURCES — enforced at the zod layer, same pattern as crm.activities.type.
    source: text("source").notNull(),
    campaign: text("campaign"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    // LEAD_STATUSES — zod-validated on input, and further guarded by
    // assertValidLeadTransition() in LeadsService so an invalid jump
    // (e.g. Converted -> New) can't reach the database.
    status: text("status").notNull().default("New"),
    score: integer("score").notNull().default(0),
    industry: text("industry"),
    location: text("location"),
    estimatedValue: numeric("estimated_value", { precision: 12, scale: 2 }),
    currency: text("currency"),
    notes: text("notes"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    // Generated tsvector column, maintained by Postgres itself — added via
    // raw SQL in the migration (drizzle-kit has no first-class tsvector
    // helper). Declared here as a plain text placeholder so Drizzle knows
    // the column exists for typed selects; never written to from app code.
    // Same technique as crm.accounts/crm.contacts (see crm.schema.ts).
    searchVector: text("search_vector"),
    convertedAccountId: uuid("converted_account_id").references(() => accounts.id, { onDelete: "set null" }),
    convertedContactId: uuid("converted_contact_id").references(() => contacts.id, { onDelete: "set null" }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("leads_org_idx").on(table.organizationId),
    orgStatusIdx: index("leads_org_status_idx").on(table.organizationId, table.status),
    // Duplicate-detection lookup (GET /leads/duplicates) filters by org + email.
    orgEmailIdx: index("leads_org_email_idx").on(table.organizationId, table.email),
    ownerIdx: index("leads_owner_idx").on(table.ownerId),
  }),
);

export const leadScoringRules = leadsSchema.table(
  "lead_scoring_rules",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // "companySize" | "email" | "source" | "industry" | "estimatedValue" — zod-enforced.
    field: text("field").notNull(),
    // "equals" | "in" | "greaterThan" | "lessThan" | "isBusinessEmail" — zod-enforced.
    operator: text("operator").notNull(),
    value: jsonb("value").$type<string | number | string[] | null>(),
    points: integer("points").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    orgIdx: index("lead_scoring_rules_org_idx").on(table.organizationId),
  }),
);

export const leadsRelations = relations(leads, ({ one }) => ({
  organization: one(organizations, { fields: [leads.organizationId], references: [organizations.id] }),
  owner: one(users, { fields: [leads.ownerId], references: [users.id] }),
  convertedAccount: one(accounts, { fields: [leads.convertedAccountId], references: [accounts.id] }),
  convertedContact: one(contacts, { fields: [leads.convertedContactId], references: [contacts.id] }),
}));

export const leadScoringRulesRelations = relations(leadScoringRules, ({ one }) => ({
  organization: one(organizations, { fields: [leadScoringRules.organizationId], references: [organizations.id] }),
}));
