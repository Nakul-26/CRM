import { randomUUID } from "node:crypto";
import { boolean, index, integer, numeric, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations } from "./identity.schema";

/**
 * One Postgres schema per domain module (see docs/architecture/overview.md).
 * The `products` module owns everything under the `products` schema.
 */
export const productsSchema = pgSchema("products");

export const products = productsSchema.table(
  "products",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku"),
    description: text("description"),
    category: text("category"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("products_org_idx").on(table.organizationId),
    orgActiveIdx: index("products_org_active_idx").on(table.organizationId, table.isActive),
  }),
);

export const productPriceTiers = productsSchema.table(
  "product_price_tiers",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    minQuantity: integer("min_quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    productMinQtyIdx: index("product_price_tiers_product_min_qty_idx").on(table.productId, table.minQuantity),
  }),
);

export const productsRelations = relations(products, ({ one, many }) => ({
  organization: one(organizations, { fields: [products.organizationId], references: [organizations.id] }),
  priceTiers: many(productPriceTiers),
}));

export const productPriceTiersRelations = relations(productPriceTiers, ({ one }) => ({
  organization: one(organizations, { fields: [productPriceTiers.organizationId], references: [organizations.id] }),
  product: one(products, { fields: [productPriceTiers.productId], references: [products.id] }),
}));
