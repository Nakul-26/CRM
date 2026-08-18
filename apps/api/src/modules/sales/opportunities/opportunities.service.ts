import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type {
  CreateOpportunityInput,
  MoveOpportunityStageInput,
  OpportunityForecastPointDto,
  OpportunityStageHistoryEntryDto,
  OpportunitySummaryStatsDto,
  UpdateOpportunityInput,
} from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { accounts, auditLog, contacts, opportunities } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";
import { PipelinesService } from "../pipelines/pipelines.service";

export interface OpportunityFilters {
  pipelineId?: string;
  stageId?: string;
  ownerId?: string;
  outcome?: string;
}

/** Drizzle deserializes `numeric` columns as strings; the contract promises `number`. */
function serializeOpportunity<T extends { value: string | null }>(row: T) {
  return { ...row, value: row.value === null ? null : Number(row.value) };
}

@Injectable()
export class OpportunitiesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
    private readonly pipelines: PipelinesService,
  ) {}

  async list(organizationId: string, filters: OpportunityFilters) {
    const conditions = [eq(opportunities.organizationId, organizationId), isNull(opportunities.deletedAt)];
    if (filters.pipelineId) conditions.push(eq(opportunities.pipelineId, filters.pipelineId));
    if (filters.stageId) conditions.push(eq(opportunities.stageId, filters.stageId));
    if (filters.ownerId) conditions.push(eq(opportunities.ownerId, filters.ownerId));
    if (filters.outcome) conditions.push(eq(opportunities.outcome, filters.outcome));
    const rows = await this.db.select().from(opportunities).where(and(...conditions));
    return rows.map(serializeOpportunity);
  }

  async findById(organizationId: string, opportunityId: string) {
    const [opportunity] = await this.db
      .select()
      .from(opportunities)
      .where(
        and(
          eq(opportunities.organizationId, organizationId),
          eq(opportunities.id, opportunityId),
          isNull(opportunities.deletedAt),
        ),
      )
      .limit(1);
    if (!opportunity) throw new NotFoundException(`Opportunity ${opportunityId} not found`);
    return serializeOpportunity(opportunity);
  }

  async create(organizationId: string, actorId: string, input: CreateOpportunityInput) {
    await this.requireAccountInOrganization(organizationId, input.accountId);
    if (input.contactId) await this.requireContactInOrganization(organizationId, input.contactId);

    const pipeline = input.pipelineId
      ? await this.pipelines.findById(organizationId, input.pipelineId)
      : await this.pipelines.getOrCreateDefault(organizationId);

    const stage = input.stageId
      ? await this.pipelines.findStage(organizationId, input.stageId)
      : await this.pipelines.firstStage(organizationId, pipeline.id);
    if (stage.pipelineId !== pipeline.id) {
      throw new BadRequestException("stageId must belong to the selected pipeline");
    }

    const [opportunity] = await this.db
      .insert(opportunities)
      .values({
        organizationId,
        ...input,
        pipelineId: pipeline.id,
        stageId: stage.id,
        probability: input.probability ?? stage.probability,
        outcome: stage.isWon ? "won" : stage.isLost ? "lost" : "open",
        closedAt: stage.isWon || stage.isLost ? new Date() : undefined,
        value: input.value !== undefined ? String(input.value) : undefined,
        expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : undefined,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    this.events.publish({
      eventType: "opportunity.created",
      organizationId,
      actorId,
      payload: { opportunityId: opportunity.id, accountId: opportunity.accountId, name: opportunity.name },
    });
    return serializeOpportunity(opportunity);
  }

  async update(organizationId: string, actorId: string, opportunityId: string, input: UpdateOpportunityInput) {
    const existing = await this.findById(organizationId, opportunityId);
    if (input.contactId) await this.requireContactInOrganization(organizationId, input.contactId);

    const [opportunity] = await this.db
      .update(opportunities)
      .set({
        ...input,
        value: input.value !== undefined ? String(input.value) : undefined,
        expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : undefined,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .where(and(eq(opportunities.organizationId, organizationId), eq(opportunities.id, opportunityId)))
      .returning();

    this.events.publish({
      eventType: "opportunity.updated",
      organizationId,
      actorId,
      payload: { opportunityId, accountId: existing.accountId, changes: input },
    });
    return serializeOpportunity(opportunity);
  }

  async delete(organizationId: string, actorId: string, opportunityId: string) {
    const existing = await this.findById(organizationId, opportunityId);

    await this.db
      .update(opportunities)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(opportunities.organizationId, organizationId), eq(opportunities.id, opportunityId)));

    this.events.publish({
      eventType: "opportunity.deleted",
      organizationId,
      actorId,
      payload: { opportunityId, accountId: existing.accountId },
    });
  }

  /**
   * No fixed transition graph — stages are org-defined, so the only
   * server-enforced rules are: the opportunity can't already be closed
   * (won/lost stages are terminal, brief §35), and the target stage must
   * belong to the opportunity's own pipeline.
   */
  async moveStage(organizationId: string, actorId: string, opportunityId: string, input: MoveOpportunityStageInput) {
    const existing = await this.findById(organizationId, opportunityId);
    if (existing.outcome !== "open") {
      throw new BadRequestException("Opportunity is closed and cannot change stages");
    }

    const targetStage = await this.pipelines.findStage(organizationId, input.stageId);
    if (targetStage.pipelineId !== existing.pipelineId) {
      throw new BadRequestException("Target stage must belong to the opportunity's pipeline");
    }

    const outcome = targetStage.isWon ? "won" : targetStage.isLost ? "lost" : "open";
    const [opportunity] = await this.db
      .update(opportunities)
      .set({
        stageId: targetStage.id,
        probability: input.probability ?? targetStage.probability,
        outcome,
        closedAt: outcome === "open" ? null : new Date(),
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .where(and(eq(opportunities.organizationId, organizationId), eq(opportunities.id, opportunityId)))
      .returning();

    this.events.publish({
      eventType: "opportunity.stage_changed",
      organizationId,
      actorId,
      payload: { opportunityId, accountId: existing.accountId, fromStageId: existing.stageId, toStageId: targetStage.id },
    });

    if (outcome === "won") {
      this.events.publish({
        eventType: "opportunity.won",
        organizationId,
        actorId,
        payload: { opportunityId, accountId: existing.accountId, value: opportunity.value, currency: opportunity.currency },
      });
    } else if (outcome === "lost") {
      this.events.publish({
        eventType: "opportunity.lost",
        organizationId,
        actorId,
        payload: { opportunityId, accountId: existing.accountId, value: opportunity.value, currency: opportunity.currency },
      });
    }

    return serializeOpportunity(opportunity);
  }

  /**
   * Automation entry point for Phase 8: reacts to `quote.accepted` (see
   * QuoteAcceptedListener in sales/automation/). No-ops rather than throws
   * for every case where advancing doesn't make sense — the opportunity may
   * already be closed, or its pipeline may simply have no `isWon` stage —
   * since this runs off an event, not a user action with something to
   * report back to. `updatedBy`/`actorId` are left unset (system-originated
   * write), same precedent SubscriptionsService.lapseIfDue() already set.
   */
  async autoAdvanceOnQuoteAccepted(organizationId: string, opportunityId: string) {
    const [existing] = await this.db
      .select()
      .from(opportunities)
      .where(
        and(
          eq(opportunities.organizationId, organizationId),
          eq(opportunities.id, opportunityId),
          isNull(opportunities.deletedAt),
        ),
      )
      .limit(1);
    if (!existing || existing.outcome !== "open") return;

    const winStage = await this.pipelines.findWinStage(organizationId, existing.pipelineId);
    if (!winStage) return;

    const [opportunity] = await this.db
      .update(opportunities)
      .set({
        stageId: winStage.id,
        probability: winStage.probability,
        outcome: "won",
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(opportunities.organizationId, organizationId), eq(opportunities.id, opportunityId)))
      .returning();

    this.events.publish({
      eventType: "opportunity.stage_changed",
      organizationId,
      payload: { opportunityId, accountId: existing.accountId, fromStageId: existing.stageId, toStageId: winStage.id },
    });
    this.events.publish({
      eventType: "opportunity.won",
      organizationId,
      payload: { opportunityId, accountId: existing.accountId, value: opportunity.value, currency: opportunity.currency },
    });
  }

  async stageHistory(organizationId: string, opportunityId: string): Promise<OpportunityStageHistoryEntryDto[]> {
    await this.findById(organizationId, opportunityId);

    const rows = await this.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, organizationId),
          eq(auditLog.eventType, "opportunity.stage_changed"),
          sql`${auditLog.payload}->>'opportunityId' = ${opportunityId}`,
        ),
      )
      .orderBy(auditLog.createdAt);

    return rows.map((row) => {
      const payload = row.payload as Record<string, unknown> | null;
      return {
        id: row.id,
        opportunityId,
        fromStageId: (payload?.fromStageId as string | undefined) ?? null,
        toStageId: payload?.toStageId as string,
        actorId: row.actorId ?? undefined,
        occurredAt: row.createdAt.toISOString(),
      };
    });
  }

  /**
   * Grouped-by-outcome aggregate query (same `sql<number>` pattern as
   * Leads' statsBySource) — covers Section 21's "Sales" metrics list.
   * Sales velocity = (won count * avg deal size * win rate) / avg sales
   * cycle days, guarded against divide-by-zero when there's no won history yet.
   */
  async summaryStats(organizationId: string): Promise<OpportunitySummaryStatsDto> {
    const rows = await this.db
      .select({
        outcome: opportunities.outcome,
        count: sql<number>`count(*)::int`,
        totalValue: sql<string>`coalesce(sum(${opportunities.value}), 0)`,
        weightedValue: sql<string>`coalesce(sum(${opportunities.value} * ${opportunities.probability} / 100.0), 0)`,
        avgCycleDays: sql<string | null>`avg(extract(epoch from (${opportunities.closedAt} - ${opportunities.createdAt})) / 86400)`,
      })
      .from(opportunities)
      .where(and(eq(opportunities.organizationId, organizationId), isNull(opportunities.deletedAt)))
      .groupBy(opportunities.outcome);

    const open = rows.find((r) => r.outcome === "open");
    const won = rows.find((r) => r.outcome === "won");
    const lost = rows.find((r) => r.outcome === "lost");

    const openCount = open?.count ?? 0;
    const wonCount = won?.count ?? 0;
    const lostCount = lost?.count ?? 0;
    const wonRevenue = won ? Number(won.totalValue) : 0;
    const lostRevenue = lost ? Number(lost.totalValue) : 0;
    const winRate = wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : 0;
    const averageDealSize = wonCount > 0 ? wonRevenue / wonCount : 0;
    const averageSalesCycleDays = won?.avgCycleDays ? Number(won.avgCycleDays) : 0;
    const salesVelocity =
      averageSalesCycleDays > 0 ? (wonCount * averageDealSize * winRate) / averageSalesCycleDays : 0;

    return {
      openCount,
      wonCount,
      lostCount,
      totalPipelineValue: open ? Number(open.totalValue) : 0,
      weightedPipelineValue: open ? Number(open.weightedValue) : 0,
      wonRevenue,
      lostRevenue,
      winRate,
      averageDealSize,
      averageSalesCycleDays,
      salesVelocity,
    };
  }

  async forecastByMonth(organizationId: string): Promise<OpportunityForecastPointDto[]> {
    const monthExpr = sql`to_char(${opportunities.expectedCloseDate}, 'YYYY-MM')`;
    const rows = await this.db
      .select({
        month: sql<string>`${monthExpr}`,
        value: sql<string>`coalesce(sum(${opportunities.value}), 0)`,
        weightedValue: sql<string>`coalesce(sum(${opportunities.value} * ${opportunities.probability} / 100.0), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.organizationId, organizationId),
          isNull(opportunities.deletedAt),
          eq(opportunities.outcome, "open"),
          sql`${opportunities.expectedCloseDate} is not null`,
        ),
      )
      .groupBy(monthExpr)
      .orderBy(monthExpr);

    return rows.map((row) => ({
      month: row.month,
      value: Number(row.value),
      weightedValue: Number(row.weightedValue),
      count: row.count,
    }));
  }

  private async requireAccountInOrganization(organizationId: string, accountId: string) {
    const [account] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.organizationId, organizationId), eq(accounts.id, accountId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!account) throw new NotFoundException(`Account ${accountId} not found`);
  }

  private async requireContactInOrganization(organizationId: string, contactId: string) {
    const [contact] = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId), isNull(contacts.deletedAt)))
      .limit(1);
    if (!contact) throw new NotFoundException(`Contact ${contactId} not found`);
  }
}
