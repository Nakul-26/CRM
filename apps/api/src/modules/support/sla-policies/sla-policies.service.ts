import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ERROR_CODES, type CreateSlaPolicyInput, type TicketPriority, type UpdateSlaPolicyInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { slaPolicies } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";

@Injectable()
export class SlaPoliciesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
  ) {}

  async list(organizationId: string) {
    return this.db
      .select()
      .from(slaPolicies)
      .where(and(eq(slaPolicies.organizationId, organizationId), isNull(slaPolicies.deletedAt)))
      .orderBy(asc(slaPolicies.priority));
  }

  async findById(organizationId: string, policyId: string) {
    const [policy] = await this.db
      .select()
      .from(slaPolicies)
      .where(and(eq(slaPolicies.organizationId, organizationId), eq(slaPolicies.id, policyId), isNull(slaPolicies.deletedAt)))
      .limit(1);
    if (!policy) throw new NotFoundException(`SLA policy ${policyId} not found`);
    return policy;
  }

  /** Used by TicketsService to snapshot due-at targets onto a new ticket. */
  async findByPriority(organizationId: string, priority: TicketPriority) {
    const [policy] = await this.db
      .select()
      .from(slaPolicies)
      .where(and(eq(slaPolicies.organizationId, organizationId), eq(slaPolicies.priority, priority), isNull(slaPolicies.deletedAt)))
      .limit(1);
    return policy ?? null;
  }

  async create(organizationId: string, actorId: string, input: CreateSlaPolicyInput) {
    const existing = await this.findByPriority(organizationId, input.priority);
    if (existing) {
      throw new ConflictException({
        code: ERROR_CODES.CONFLICT,
        message: `An SLA policy for priority "${input.priority}" already exists`,
      });
    }

    const [policy] = await this.db
      .insert(slaPolicies)
      .values({ organizationId, ...input, createdBy: actorId, updatedBy: actorId })
      .returning();

    this.events.publish({
      eventType: "sla_policy.created",
      organizationId,
      actorId,
      payload: { slaPolicyId: policy.id, priority: policy.priority },
    });
    return policy;
  }

  async update(organizationId: string, actorId: string, policyId: string, input: UpdateSlaPolicyInput) {
    const existing = await this.findById(organizationId, policyId);

    if (input.priority && input.priority !== existing.priority) {
      const conflict = await this.findByPriority(organizationId, input.priority);
      if (conflict) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: `An SLA policy for priority "${input.priority}" already exists`,
        });
      }
    }

    const [policy] = await this.db
      .update(slaPolicies)
      .set({ ...input, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(slaPolicies.organizationId, organizationId), eq(slaPolicies.id, policyId)))
      .returning();

    this.events.publish({
      eventType: "sla_policy.updated",
      organizationId,
      actorId,
      payload: { slaPolicyId: policyId, changes: input },
    });
    return policy;
  }

  async delete(organizationId: string, actorId: string, policyId: string) {
    await this.findById(organizationId, policyId);

    await this.db
      .update(slaPolicies)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(slaPolicies.organizationId, organizationId), eq(slaPolicies.id, policyId)));

    this.events.publish({
      eventType: "sla_policy.deleted",
      organizationId,
      actorId,
      payload: { slaPolicyId: policyId },
    });
  }
}
