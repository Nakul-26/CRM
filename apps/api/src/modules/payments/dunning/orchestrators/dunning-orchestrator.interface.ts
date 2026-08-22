export interface DunningCycleInput {
  organizationId: string;
  actorId: string;
  subscriptionId: string;
  paymentId: string;
}

export interface DunningAttemptOutcomeInput extends DunningCycleInput {
  succeeded: boolean;
}

/**
 * Orchestrates the wait/retry timing of a subscription's dunning process.
 * All business logic (what an attempt/exhaustion actually does) lives in
 * DunningActionsService — implementations here only decide *when* the next
 * attempt happens. See docs/decisions/0016-temporal-dunning-phase16-scope.md.
 */
export interface DunningOrchestrator {
  readonly kind: "in-process" | "temporal";

  /**
   * Whether a dunning cycle is currently in flight for this subscription —
   * decided by asking the same orchestrator that will go on to act (its own
   * Postgres row, or the Temporal workflow's own execution state), so the
   * "start vs. continue" decision and the action that follows are always
   * consistent even under fallback.
   */
  hasActiveCycle(subscriptionId: string): Promise<boolean>;

  /** Starts a new dunning cycle for a subscription's first failed payment. */
  startDunning(input: DunningCycleInput): Promise<void>;

  /**
   * Reports the outcome of a retry attempt (a later payment.succeeded/
   * payment.failed event for a payment created by attemptCharge) back to
   * whichever cycle is in flight for this subscription.
   */
  recordAttemptOutcome(input: DunningAttemptOutcomeInput): Promise<void>;
}

export const DUNNING_ORCHESTRATOR = Symbol("DUNNING_ORCHESTRATOR");
