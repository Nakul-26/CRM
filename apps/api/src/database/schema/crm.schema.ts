import { randomUUID } from "node:crypto";
import { index, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations, users } from "./identity.schema";

/**
 * One Postgres schema per domain module (see docs/architecture/overview.md).
 * The `crm` module owns everything under the `crm` schema; no other module
 * may reference these tables directly.
 */
export const crmSchema = pgSchema("crm");

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export const accounts = crmSchema.table(
  "accounts",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    industry: text("industry"),
    companySize: text("company_size"),
    website: text("website"),
    email: text("email"),
    phone: text("phone"),
    billingAddress: jsonb("billing_address").$type<Address>(),
    shippingAddress: jsonb("shipping_address").$type<Address>(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    // Generated tsvector column, maintained by Postgres itself — added via
    // raw SQL in the migration (drizzle-kit has no first-class tsvector
    // helper). Declared here as a plain text placeholder so Drizzle knows
    // the column exists for typed selects; never written to from app code.
    searchVector: text("search_vector"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("accounts_org_idx").on(table.organizationId),
    orgNameIdx: index("accounts_org_name_idx").on(table.organizationId, table.name),
    ownerIdx: index("accounts_owner_idx").on(table.ownerId),
  }),
);

export const contacts = crmSchema.table(
  "contacts",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    jobTitle: text("job_title"),
    department: text("department"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    socialProfiles: jsonb("social_profiles").$type<Record<string, string>>(),
    communicationPreferences: jsonb("communication_preferences").$type<{
      email?: boolean;
      phone?: boolean;
      sms?: boolean;
    }>(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    searchVector: text("search_vector"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("contacts_org_idx").on(table.organizationId),
    accountIdx: index("contacts_account_idx").on(table.accountId),
    // No unique constraint on email — the same address can legitimately
    // appear across different accounts (e.g. a shared inbox); not in the brief.
  }),
);

export const activities = crmSchema.table(
  "activities",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    // "call" | "email" | "meeting" | "note" | "task" — enforced at the zod layer.
    type: text("type").notNull(),
    subject: text("subject").notNull(),
    body: text("body"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index("activities_org_idx").on(table.organizationId),
    accountIdx: index("activities_account_idx").on(table.accountId),
    contactIdx: index("activities_contact_idx").on(table.contactId),
    // Timeline is always "most recent first" — index the sort key directly.
    accountCreatedIdx: index("activities_account_created_idx").on(table.accountId, table.createdAt),
  }),
);

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  organization: one(organizations, { fields: [accounts.organizationId], references: [organizations.id] }),
  owner: one(users, { fields: [accounts.ownerId], references: [users.id] }),
  contacts: many(contacts),
  activities: many(activities),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  organization: one(organizations, { fields: [contacts.organizationId], references: [organizations.id] }),
  account: one(accounts, { fields: [contacts.accountId], references: [accounts.id] }),
  owner: one(users, { fields: [contacts.ownerId], references: [users.id] }),
  activities: many(activities),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  organization: one(organizations, { fields: [activities.organizationId], references: [organizations.id] }),
  account: one(accounts, { fields: [activities.accountId], references: [accounts.id] }),
  contact: one(contacts, { fields: [activities.contactId], references: [contacts.id] }),
  owner: one(users, { fields: [activities.ownerId], references: [users.id] }),
}));
