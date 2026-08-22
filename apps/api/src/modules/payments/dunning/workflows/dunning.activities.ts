import type { DunningActionsService } from "../dunning-actions.service";

export interface DunningActivities {
  attemptCharge(organizationId: string, actorId: string, subscriptionId: string): Promise<{ paymentId: string }>;
  cancelSubscription(organizationId: string, actorId: string, subscriptionId: string): Promise<void>;
}

/**
 * Thin wrappers around DunningActionsService, built as a factory at worker
 * start time from the Nest-resolved service instance — Temporal's worker
 * activities are plain functions, not DI-managed, so this is the bridge
 * between the two. See docs/decisions/0016-temporal-dunning-phase16-scope.md.
 */
export function createDunningActivities(actions: DunningActionsService): DunningActivities {
  return {
    attemptCharge: (organizationId, actorId, subscriptionId) => actions.attemptCharge(organizationId, actorId, subscriptionId),
    cancelSubscription: (organizationId, actorId, subscriptionId) => actions.cancelSubscription(organizationId, actorId, subscriptionId),
  };
}
