import type { SubscriptionStatus } from "@sales-platform/contracts";

export interface SubscriptionLapseInput {
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
}

/**
 * Whether an active subscription's period has ended without a renewal.
 * Checked/persisted on access ("touch-on-access"), the same lazy pattern
 * QuotesService.expireIfDue uses — see
 * docs/decisions/0007-subscriptions-phase7-scope.md. Only "active" can
 * lapse; "lapsed" and "cancelled" are left alone (idempotent).
 */
export function isLapseDue(subscription: SubscriptionLapseInput, now: Date): boolean {
  return subscription.status === "active" && subscription.currentPeriodEnd < now;
}
