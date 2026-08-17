import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ERROR_CODES, type CreatePlanInput, type UpdatePlanInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { plans } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";

function serializePlan<T extends { price: string }>(row: T) {
  return { ...row, price: Number(row.price) };
}

@Injectable()
export class PlansService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
  ) {}

  async list(organizationId: string) {
    const rows = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.organizationId, organizationId), isNull(plans.deletedAt)))
      .orderBy(asc(plans.name));
    return rows.map(serializePlan);
  }

  async findById(organizationId: string, planId: string) {
    const [plan] = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.organizationId, organizationId), eq(plans.id, planId), isNull(plans.deletedAt)))
      .limit(1);
    if (!plan) throw new NotFoundException(`Plan ${planId} not found`);
    return serializePlan(plan);
  }

  /** Used by SubscriptionsService to snapshot plan fields onto a new subscription. Bypasses serialization — callers need the raw numeric string for DB writes. */
  async getRawByIdOrThrow(organizationId: string, planId: string) {
    const [plan] = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.organizationId, organizationId), eq(plans.id, planId), isNull(plans.deletedAt)))
      .limit(1);
    if (!plan) throw new NotFoundException(`Plan ${planId} not found`);
    return plan;
  }

  private async assertNameAvailable(organizationId: string, name: string) {
    const [existing] = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.organizationId, organizationId), eq(plans.name, name), isNull(plans.deletedAt)))
      .limit(1);
    if (existing) {
      throw new ConflictException({
        code: ERROR_CODES.CONFLICT,
        message: `A plan named "${name}" already exists`,
      });
    }
  }

  async create(organizationId: string, actorId: string, input: CreatePlanInput) {
    await this.assertNameAvailable(organizationId, input.name);

    const [plan] = await this.db
      .insert(plans)
      .values({ organizationId, ...input, price: input.price.toString(), createdBy: actorId, updatedBy: actorId })
      .returning();

    this.events.publish({
      eventType: "plan.created",
      organizationId,
      actorId,
      payload: { planId: plan.id, name: plan.name },
    });
    return serializePlan(plan);
  }

  async update(organizationId: string, actorId: string, planId: string, input: UpdatePlanInput) {
    const existing = await this.findById(organizationId, planId);

    if (input.name && input.name !== existing.name) {
      await this.assertNameAvailable(organizationId, input.name);
    }

    const [plan] = await this.db
      .update(plans)
      .set({
        ...input,
        price: input.price !== undefined ? input.price.toString() : undefined,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .where(and(eq(plans.organizationId, organizationId), eq(plans.id, planId)))
      .returning();

    this.events.publish({
      eventType: "plan.updated",
      organizationId,
      actorId,
      payload: { planId, changes: input },
    });
    return serializePlan(plan);
  }

  async delete(organizationId: string, actorId: string, planId: string) {
    await this.findById(organizationId, planId);

    await this.db
      .update(plans)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(plans.organizationId, organizationId), eq(plans.id, planId)));

    this.events.publish({
      eventType: "plan.deleted",
      organizationId,
      actorId,
      payload: { planId },
    });
  }
}
