import { condition, defineSignal, proxyActivities, setHandler, sleep } from "@temporalio/workflow";
import type { DunningActivities } from "./dunning.activities";

export interface DunningWorkflowInput {
  organizationId: string;
  actorId: string;
  subscriptionId: string;
  initialPaymentId: string;
  retryDelaysMs: number[];
}

export interface PaymentResolvedSignal {
  paymentId: string;
  succeeded: boolean;
}

export const paymentResolvedSignal = defineSignal<[PaymentResolvedSignal]>("paymentResolved");

const { attemptCharge, cancelSubscription } = proxyActivities<DunningActivities>({
  startToCloseTimeout: "1 minute",
});

/**
 * Intentionally minimal — sleep/attempt/wait-for-outcome loop only, no
 * direct DB or service access (Temporal's workflow-sandbox determinism
 * constraint). All business logic lives in dunning.activities.ts /
 * DunningActionsService. See
 * docs/decisions/0016-temporal-dunning-phase16-scope.md.
 *
 * A charge attempt's outcome (succeeded/failed) never resolves
 * synchronously from attemptChargeActivity — it arrives later, async, as a
 * payment.succeeded/payment.failed domain event (mock checkout completion
 * or a real Stripe webhook). DunningListener signals this workflow with
 * that outcome once it arrives; `condition` below is what makes the
 * workflow durably wait for it, surviving worker restarts in between.
 */
export async function dunningWorkflow(input: DunningWorkflowInput): Promise<void> {
  let latestPaymentId = input.initialPaymentId;
  // Boxed, and read only through getOutcome() below — a plain variable/
  // property access gets narrowed by TS based on the last synchronous
  // assignment, which is wrong here since setHandler's closure can mutate it
  // across the `await condition(...)` in between. Routing the read through a
  // function call defeats that (incorrect) narrowing.
  const outcomeBox: { current: PaymentResolvedSignal | undefined } = { current: undefined };
  const getOutcome = (): PaymentResolvedSignal | undefined => outcomeBox.current;

  setHandler(paymentResolvedSignal, (signal) => {
    if (signal.paymentId === latestPaymentId) outcomeBox.current = signal;
  });

  for (const delayMs of input.retryDelaysMs) {
    await sleep(delayMs);

    outcomeBox.current = undefined;
    const { paymentId } = await attemptCharge(input.organizationId, input.actorId, input.subscriptionId);
    latestPaymentId = paymentId;

    // A payment that never resolves within this bound is treated the same
    // as a failed attempt — this timeout is a safety bound, not part of the
    // retry schedule itself (which is entirely `retryDelaysMs`).
    await condition(() => getOutcome() !== undefined, "3 days");
    if (getOutcome()?.succeeded) return;
  }

  await cancelSubscription(input.organizationId, input.actorId, input.subscriptionId);
}
