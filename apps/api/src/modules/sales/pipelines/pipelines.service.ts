import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { CreatePipelineInput, CreateStageInput, UpdatePipelineInput, UpdateStageInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { opportunities, pipelines, stages } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";

/** Seeded into a brand-new org's default pipeline the first time it's needed. */
const DEFAULT_STAGES: Array<Pick<CreateStageInput, "name" | "order" | "probability" | "isWon" | "isLost">> = [
  { name: "Qualification", order: 1, probability: 10, isWon: false, isLost: false },
  { name: "Discovery", order: 2, probability: 25, isWon: false, isLost: false },
  { name: "Proposal", order: 3, probability: 50, isWon: false, isLost: false },
  { name: "Negotiation", order: 4, probability: 75, isWon: false, isLost: false },
  { name: "Closed Won", order: 5, probability: 100, isWon: true, isLost: false },
  { name: "Closed Lost", order: 6, probability: 0, isWon: false, isLost: true },
];

@Injectable()
export class PipelinesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
  ) {}

  async list(organizationId: string) {
    await this.getOrCreateDefault(organizationId);
    return this.db
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.organizationId, organizationId), isNull(pipelines.deletedAt)));
  }

  async findById(organizationId: string, pipelineId: string) {
    const [pipeline] = await this.db
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.organizationId, organizationId), eq(pipelines.id, pipelineId), isNull(pipelines.deletedAt)))
      .limit(1);
    if (!pipeline) throw new NotFoundException(`Pipeline ${pipelineId} not found`);
    return pipeline;
  }

  async stagesFor(organizationId: string, pipelineId: string) {
    await this.findById(organizationId, pipelineId);
    return this.db
      .select()
      .from(stages)
      .where(and(eq(stages.organizationId, organizationId), eq(stages.pipelineId, pipelineId)))
      .orderBy(stages.order);
  }

  async findStage(organizationId: string, stageId: string) {
    const [stage] = await this.db
      .select()
      .from(stages)
      .where(and(eq(stages.organizationId, organizationId), eq(stages.id, stageId)))
      .limit(1);
    if (!stage) throw new NotFoundException(`Stage ${stageId} not found`);
    return stage;
  }

  /** First stage (lowest order) of a pipeline — used to default a new Opportunity's stage. */
  async firstStage(organizationId: string, pipelineId: string) {
    const [stage] = await this.db
      .select()
      .from(stages)
      .where(and(eq(stages.organizationId, organizationId), eq(stages.pipelineId, pipelineId)))
      .orderBy(stages.order)
      .limit(1);
    if (!stage) throw new NotFoundException(`Pipeline ${pipelineId} has no stages`);
    return stage;
  }

  /**
   * Idempotently ensures the org has a default pipeline, seeding "Sales
   * Pipeline" with the brief's 6 example stages the first time it's needed
   * (lazy creation on first read/use, not on org-creation — avoids a race
   * between registration and first opportunity/pipeline access, and needs
   * no new event-consumer plumbing).
   */
  async getOrCreateDefault(organizationId: string) {
    const [existing] = await this.db
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.organizationId, organizationId), eq(pipelines.isDefault, true), isNull(pipelines.deletedAt)))
      .limit(1);
    if (existing) return existing;

    return this.db.transaction(async (tx) => {
      const [pipeline] = await tx
        .insert(pipelines)
        .values({ organizationId, name: "Sales Pipeline", isDefault: true })
        .returning();

      await tx.insert(stages).values(DEFAULT_STAGES.map((stage) => ({ organizationId, pipelineId: pipeline.id, ...stage })));

      return pipeline;
    });
  }

  async create(organizationId: string, actorId: string, input: CreatePipelineInput) {
    if (input.isDefault) {
      await this.unsetExistingDefault(organizationId, actorId);
    }
    const [pipeline] = await this.db
      .insert(pipelines)
      .values({ organizationId, ...input, createdBy: actorId, updatedBy: actorId })
      .returning();

    this.events.publish({
      eventType: "pipeline.created",
      organizationId,
      actorId,
      payload: { pipelineId: pipeline.id, name: pipeline.name },
    });
    return pipeline;
  }

  async update(organizationId: string, actorId: string, pipelineId: string, input: UpdatePipelineInput) {
    await this.findById(organizationId, pipelineId);
    if (input.isDefault) {
      await this.unsetExistingDefault(organizationId, actorId, pipelineId);
    }

    const [pipeline] = await this.db
      .update(pipelines)
      .set({ ...input, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(pipelines.organizationId, organizationId), eq(pipelines.id, pipelineId)))
      .returning();

    this.events.publish({
      eventType: "pipeline.updated",
      organizationId,
      actorId,
      payload: { pipelineId, changes: input },
    });
    return pipeline;
  }

  async delete(organizationId: string, actorId: string, pipelineId: string) {
    await this.findById(organizationId, pipelineId);

    const [inUse] = await this.db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(eq(opportunities.pipelineId, pipelineId), isNull(opportunities.deletedAt)))
      .limit(1);
    if (inUse) throw new BadRequestException("Cannot delete a pipeline that still has opportunities");

    await this.db
      .update(pipelines)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(pipelines.organizationId, organizationId), eq(pipelines.id, pipelineId)));

    this.events.publish({
      eventType: "pipeline.deleted",
      organizationId,
      actorId,
      payload: { pipelineId },
    });
  }

  async createStage(organizationId: string, actorId: string, pipelineId: string, input: CreateStageInput) {
    await this.findById(organizationId, pipelineId);
    const [stage] = await this.db
      .insert(stages)
      .values({ organizationId, pipelineId, ...input })
      .returning();

    this.events.publish({
      eventType: "stage.created",
      organizationId,
      actorId,
      payload: { stageId: stage.id, pipelineId },
    });
    return stage;
  }

  async updateStage(organizationId: string, actorId: string, pipelineId: string, stageId: string, input: UpdateStageInput) {
    await this.findById(organizationId, pipelineId);
    const existing = await this.findStage(organizationId, stageId);
    if (existing.pipelineId !== pipelineId) throw new NotFoundException(`Stage ${stageId} not found in this pipeline`);

    const [stage] = await this.db
      .update(stages)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(stages.organizationId, organizationId), eq(stages.id, stageId)))
      .returning();

    this.events.publish({
      eventType: "stage.updated",
      organizationId,
      actorId,
      payload: { stageId, pipelineId, changes: input },
    });
    return stage;
  }

  async deleteStage(organizationId: string, actorId: string, pipelineId: string, stageId: string) {
    await this.findById(organizationId, pipelineId);
    const existing = await this.findStage(organizationId, stageId);
    if (existing.pipelineId !== pipelineId) throw new NotFoundException(`Stage ${stageId} not found in this pipeline`);

    const [inUse] = await this.db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(eq(opportunities.stageId, stageId), isNull(opportunities.deletedAt)))
      .limit(1);
    if (inUse) throw new BadRequestException("Cannot delete a stage that still has opportunities");

    await this.db.delete(stages).where(and(eq(stages.organizationId, organizationId), eq(stages.id, stageId)));

    this.events.publish({
      eventType: "stage.deleted",
      organizationId,
      actorId,
      payload: { stageId, pipelineId },
    });
  }

  private async unsetExistingDefault(organizationId: string, actorId: string, exceptPipelineId?: string) {
    const conditions = [eq(pipelines.organizationId, organizationId), eq(pipelines.isDefault, true)];
    if (exceptPipelineId) conditions.push(ne(pipelines.id, exceptPipelineId));

    await this.db
      .update(pipelines)
      .set({ isDefault: false, updatedAt: new Date(), updatedBy: actorId })
      .where(and(...conditions));
  }
}
