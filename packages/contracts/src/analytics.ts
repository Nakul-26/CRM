/**
 * Phase 8 cross-entity dashboard metrics. See
 * docs/decisions/0008-analytics-automation-phase8-scope.md — exactly the 7
 * fields named by the dashboard home page's own Phase-8 placeholder card
 * (pipeline value, win rate, MRR/ARR) plus two natural companion counts.
 */
export interface DashboardStatsDto {
  openPipelineValue: number;
  weightedPipelineValue: number;
  winRate: number;
  openOpportunitiesCount: number;
  mrr: number;
  arr: number;
  activeSubscriptionsCount: number;
}
