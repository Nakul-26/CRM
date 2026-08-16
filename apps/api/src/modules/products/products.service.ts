import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import type { CreatePriceTierInput, CreateProductInput, UpdatePriceTierInput, UpdateProductInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../database/database.module";
import { productPriceTiers, products } from "../../database/schema";
import { DomainEventBus } from "../../shared/events/domain-event-bus";

function serializeProduct<T extends { unitPrice: string; taxPercent: string }>(row: T) {
  return { ...row, unitPrice: Number(row.unitPrice), taxPercent: Number(row.taxPercent) };
}

function serializeTier<T extends { unitPrice: string }>(row: T) {
  return { ...row, unitPrice: Number(row.unitPrice) };
}

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
  ) {}

  async list(organizationId: string, filters?: { category?: string; isActive?: boolean }) {
    const conditions = [eq(products.organizationId, organizationId), isNull(products.deletedAt)];
    if (filters?.category) conditions.push(eq(products.category, filters.category));
    if (filters?.isActive !== undefined) conditions.push(eq(products.isActive, filters.isActive));

    const rows = await this.db
      .select()
      .from(products)
      .where(and(...conditions))
      .orderBy(asc(products.name));
    return rows.map(serializeProduct);
  }

  async findById(organizationId: string, productId: string) {
    const [product] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.organizationId, organizationId), eq(products.id, productId), isNull(products.deletedAt)))
      .limit(1);
    if (!product) throw new NotFoundException(`Product ${productId} not found`);
    return serializeProduct(product);
  }

  async create(organizationId: string, actorId: string, input: CreateProductInput) {
    const [product] = await this.db
      .insert(products)
      .values({
        organizationId,
        ...input,
        unitPrice: input.unitPrice.toString(),
        taxPercent: input.taxPercent.toString(),
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    this.events.publish({
      eventType: "product.created",
      organizationId,
      actorId,
      payload: { productId: product.id, name: product.name },
    });
    return serializeProduct(product);
  }

  async update(organizationId: string, actorId: string, productId: string, input: UpdateProductInput) {
    await this.findById(organizationId, productId);

    const [product] = await this.db
      .update(products)
      .set({
        ...input,
        unitPrice: input.unitPrice !== undefined ? input.unitPrice.toString() : undefined,
        taxPercent: input.taxPercent !== undefined ? input.taxPercent.toString() : undefined,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)))
      .returning();

    this.events.publish({
      eventType: "product.updated",
      organizationId,
      actorId,
      payload: { productId, changes: input },
    });
    return serializeProduct(product);
  }

  async delete(organizationId: string, actorId: string, productId: string) {
    await this.findById(organizationId, productId);

    await this.db
      .update(products)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)));

    this.events.publish({
      eventType: "product.deleted",
      organizationId,
      actorId,
      payload: { productId },
    });
  }

  /**
   * Best-matching volume tier price for a quantity (highest minQuantity
   * that's still <= quantity), falling back to the product's base price.
   * Used by Quotes to *suggest* a unit price when a line item is added —
   * the server never forces it, reps can override.
   */
  async priceFor(organizationId: string, productId: string, quantity: number): Promise<number> {
    const product = await this.findById(organizationId, productId);

    const [tier] = await this.db
      .select()
      .from(productPriceTiers)
      .where(and(eq(productPriceTiers.organizationId, organizationId), eq(productPriceTiers.productId, productId), lte(productPriceTiers.minQuantity, quantity)))
      .orderBy(desc(productPriceTiers.minQuantity))
      .limit(1);

    return tier ? Number(tier.unitPrice) : product.unitPrice;
  }

  async priceTiersFor(organizationId: string, productId: string) {
    await this.findById(organizationId, productId);
    const rows = await this.db
      .select()
      .from(productPriceTiers)
      .where(and(eq(productPriceTiers.organizationId, organizationId), eq(productPriceTiers.productId, productId)))
      .orderBy(asc(productPriceTiers.minQuantity));
    return rows.map(serializeTier);
  }

  async findTier(organizationId: string, tierId: string) {
    const [tier] = await this.db
      .select()
      .from(productPriceTiers)
      .where(and(eq(productPriceTiers.organizationId, organizationId), eq(productPriceTiers.id, tierId)))
      .limit(1);
    if (!tier) throw new NotFoundException(`Price tier ${tierId} not found`);
    return tier;
  }

  async createPriceTier(organizationId: string, actorId: string, productId: string, input: CreatePriceTierInput) {
    await this.findById(organizationId, productId);

    const [tier] = await this.db
      .insert(productPriceTiers)
      .values({ organizationId, productId, ...input, unitPrice: input.unitPrice.toString() })
      .returning();

    this.events.publish({
      eventType: "product.updated",
      organizationId,
      actorId,
      payload: { productId, priceTierId: tier.id, action: "tier_created" },
    });
    return serializeTier(tier);
  }

  async updatePriceTier(organizationId: string, actorId: string, productId: string, tierId: string, input: UpdatePriceTierInput) {
    await this.findById(organizationId, productId);
    const existing = await this.findTier(organizationId, tierId);
    if (existing.productId !== productId) throw new NotFoundException(`Price tier ${tierId} not found on this product`);

    const [tier] = await this.db
      .update(productPriceTiers)
      .set({
        ...input,
        unitPrice: input.unitPrice !== undefined ? input.unitPrice.toString() : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(productPriceTiers.organizationId, organizationId), eq(productPriceTiers.id, tierId)))
      .returning();

    this.events.publish({
      eventType: "product.updated",
      organizationId,
      actorId,
      payload: { productId, priceTierId: tierId, action: "tier_updated" },
    });
    return serializeTier(tier);
  }

  async deletePriceTier(organizationId: string, actorId: string, productId: string, tierId: string) {
    await this.findById(organizationId, productId);
    const existing = await this.findTier(organizationId, tierId);
    if (existing.productId !== productId) throw new NotFoundException(`Price tier ${tierId} not found on this product`);

    await this.db.delete(productPriceTiers).where(and(eq(productPriceTiers.organizationId, organizationId), eq(productPriceTiers.id, tierId)));

    this.events.publish({
      eventType: "product.updated",
      organizationId,
      actorId,
      payload: { productId, priceTierId: tierId, action: "tier_deleted" },
    });
  }
}
