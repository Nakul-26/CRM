import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { CreateScoringRuleInput, UpdateScoringRuleInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { leadScoringRules } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";

@Injectable()
export class ScoringRulesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
  ) {}

  async list(organizationId: string) {
    return this.db.select().from(leadScoringRules).where(eq(leadScoringRules.organizationId, organizationId));
  }

  async listActive(organizationId: string) {
    const rows = await this.list(organizationId);
    return rows.filter((rule) => rule.active);
  }

  async findById(organizationId: string, ruleId: string) {
    const [rule] = await this.db
      .select()
      .from(leadScoringRules)
      .where(and(eq(leadScoringRules.organizationId, organizationId), eq(leadScoringRules.id, ruleId)))
      .limit(1);
    if (!rule) throw new NotFoundException(`Scoring rule ${ruleId} not found`);
    return rule;
  }

  async create(organizationId: string, actorId: string, input: CreateScoringRuleInput) {
    const [rule] = await this.db
      .insert(leadScoringRules)
      .values({ organizationId, ...input, value: input.value ?? null, createdBy: actorId, updatedBy: actorId })
      .returning();

    this.events.publish({
      eventType: "lead.scoring_rule_created",
      organizationId,
      actorId,
      payload: { ruleId: rule.id, name: rule.name },
    });
    return rule;
  }

  async update(organizationId: string, actorId: string, ruleId: string, input: UpdateScoringRuleInput) {
    await this.findById(organizationId, ruleId);

    const [rule] = await this.db
      .update(leadScoringRules)
      .set({ ...input, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(leadScoringRules.organizationId, organizationId), eq(leadScoringRules.id, ruleId)))
      .returning();

    this.events.publish({
      eventType: "lead.scoring_rule_updated",
      organizationId,
      actorId,
      payload: { ruleId, changes: input },
    });
    return rule;
  }

  async delete(organizationId: string, actorId: string, ruleId: string) {
    await this.findById(organizationId, ruleId);

    await this.db.delete(leadScoringRules).where(and(eq(leadScoringRules.organizationId, organizationId), eq(leadScoringRules.id, ruleId)));

    this.events.publish({
      eventType: "lead.scoring_rule_deleted",
      organizationId,
      actorId,
      payload: { ruleId },
    });
  }
}
