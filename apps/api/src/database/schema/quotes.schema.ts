import { randomUUID } from "node:crypto";
import { boolean, index, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations, users } from "./identity.schema";
import { accounts, contacts } from "./crm.schema";
import { opportunities } from "./sales.schema";
import { products } from "./products.schema";

/**
 * One Postgres schema per domain module (see docs/architecture/overview.md).
 * The `quotes` module owns everything under the `quotes` schema. FKs to
 * `crm.accounts`/`crm.contacts`, `sales.opportunities`, and
 * `products.products` are the same accepted "FK, not a cross-module query"
 * pattern already used by `sales.schema.ts`.
 */
export const quotesSchema = pgSchema("quotes");

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;

export interface TemplateLineItem {
  productId?: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxPercent?: number;
}

export const quoteTemplates = quotesSchema.table(
  "quote_templates",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    termsText: text("terms_text"),
    defaultNotes: text("default_notes"),
    defaultLineItems: jsonb("default_line_items").$type<TemplateLineItem[]>().notNull().default([]),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("quote_templates_org_idx").on(table.organizationId),
  }),
);

export const quotes = quotesSchema.table(
  "quotes",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    // Global identity column, not per-org — see docs/decisions/0005-quotations-phase5-scope.md.
    // Display format ("Q-00001") is computed at the serialization boundary, not stored.
    sequenceNumber: integer("sequence_number").notNull().generatedAlwaysAsIdentity(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => quoteTemplates.id, { onDelete: "set null" }),
    // QUOTE_STATUSES
    status: text("status").notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(1),
    currency: text("currency").notNull().default("USD"),
    // Denormalized from the current version's totals, for list/filter queries.
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
    discountTotal: numeric("discount_total", { precision: 12, scale: 2 }).notNull().default("0"),
    taxTotal: numeric("tax_total", { precision: 12, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    shareToken: uuid("share_token"),
    notes: text("notes"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("quotes_org_idx").on(table.organizationId),
    orgStatusIdx: index("quotes_org_status_idx").on(table.organizationId, table.status),
    accountIdx: index("quotes_account_idx").on(table.accountId),
    shareTokenIdx: index("quotes_share_token_idx").on(table.shareToken),
  }),
);

export const quoteVersions = quotesSchema.table(
  "quote_versions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id").notNull().references(() => quotes.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
    discountTotal: numeric("discount_total", { precision: 12, scale: 2 }).notNull(),
    taxTotal: numeric("tax_total", { precision: 12, scale: 2 }).notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    quoteVersionIdx: index("quote_versions_quote_version_idx").on(table.quoteId, table.versionNumber),
  }),
);

export const quoteLineItems = quotesSchema.table(
  "quote_line_items",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    quoteVersionId: uuid("quote_version_id").notNull().references(() => quoteVersions.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
    taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).notNull().default("0"),
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => ({
    versionIdx: index("quote_line_items_version_idx").on(table.quoteVersionId, table.sortOrder),
  }),
);

export const quoteTemplatesRelations = relations(quoteTemplates, ({ one }) => ({
  organization: one(organizations, { fields: [quoteTemplates.organizationId], references: [organizations.id] }),
}));

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  organization: one(organizations, { fields: [quotes.organizationId], references: [organizations.id] }),
  account: one(accounts, { fields: [quotes.accountId], references: [accounts.id] }),
  contact: one(contacts, { fields: [quotes.contactId], references: [contacts.id] }),
  opportunity: one(opportunities, { fields: [quotes.opportunityId], references: [opportunities.id] }),
  owner: one(users, { fields: [quotes.ownerId], references: [users.id] }),
  template: one(quoteTemplates, { fields: [quotes.templateId], references: [quoteTemplates.id] }),
  versions: many(quoteVersions),
}));

export const quoteVersionsRelations = relations(quoteVersions, ({ one, many }) => ({
  organization: one(organizations, { fields: [quoteVersions.organizationId], references: [organizations.id] }),
  quote: one(quotes, { fields: [quoteVersions.quoteId], references: [quotes.id] }),
  lineItems: many(quoteLineItems),
}));

export const quoteLineItemsRelations = relations(quoteLineItems, ({ one }) => ({
  organization: one(organizations, { fields: [quoteLineItems.organizationId], references: [organizations.id] }),
  version: one(quoteVersions, { fields: [quoteLineItems.quoteVersionId], references: [quoteVersions.id] }),
  product: one(products, { fields: [quoteLineItems.productId], references: [products.id] }),
}));
