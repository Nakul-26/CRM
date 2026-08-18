import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DashboardStatsDto } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../database/database.module";
import { opportunities } from "../../database/schema/sales.schema";
import { subscriptions } from "../../database/schema/subscriptions.schema";

/**
 * Reads `sales.opportunities`/`subscriptions.subscriptions` directly rather
 * than injecting OpportunitiesService/SubscriptionsService — same
 * direct-cross-schema-read precedent Quotes/Support/Subscriptions already
 * established for crm.accounts/crm.contacts (see ADR 0008), applied here
 * across two already-built top-level domains.
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async dashboard(organizationId: string): Promise<DashboardStatsDto> {
    const opportunityRows = await this.db
      .select({
        outcome: opportunities.outcome,
        count: sql<number>`count(*)::int`,
        totalValue: sql<string>`coalesce(sum(${opportunities.value}), 0)`,
        weightedValue: sql<string>`coalesce(sum(${opportunities.value} * ${opportunities.probability} / 100.0), 0)`,
      })
      .from(opportunities)
      .where(and(eq(opportunities.organizationId, organizationId), isNull(opportunities.deletedAt)))
      .groupBy(opportunities.outcome);

    const open = opportunityRows.find((r) => r.outcome === "open");
    const won = opportunityRows.find((r) => r.outcome === "won");
    const lost = opportunityRows.find((r) => r.outcome === "lost");
    const wonCount = won?.count ?? 0;
    const lostCount = lost?.count ?? 0;

    const [subscriptionTotals] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        // yearly plans normalize to monthly by dividing by 12; monthly plans pass through as-is.
        mrr: sql<string>`coalesce(sum(case when ${subscriptions.billingInterval} = 'yearly' then ${subscriptions.price} / 12 else ${subscriptions.price} end), 0)`,
      })
      .from(subscriptions)
      .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.status, "active")));

    const mrr = subscriptionTotals ? Number(subscriptionTotals.mrr) : 0;

    return {
      openPipelineValue: open ? Number(open.totalValue) : 0,
      weightedPipelineValue: open ? Number(open.weightedValue) : 0,
      winRate: wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : 0,
      openOpportunitiesCount: open?.count ?? 0,
      mrr,
      arr: mrr * 12,
      activeSubscriptionsCount: subscriptionTotals?.count ?? 0,
    };
  }
}
