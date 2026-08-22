import { Inject, Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { DomainEvent } from "@sales-platform/contracts";
import { DUNNING_ORCHESTRATOR, type DunningCycleInput, type DunningOrchestrator } from "./orchestrators/dunning-orchestrator.interface";
import { PostgresDunningOrchestrator } from "./orchestrators/postgres-dunning.orchestrator";

type PaymentFailedPayload = { paymentId: string; subscriptionId: string; recipientId: string };
type PaymentSucceededPayload = { paymentId: string; subscriptionId: string; accountId: string; amount: number; recipientId: string };

/**
 * The one place dunning "starts" — reuses the existing payment.failed/
 * payment.succeeded events, no new publish call sites. The "is a cycle
 * already active for this subscription" decision and the action that
 * follows always go through the *same* orchestrator (never a mix of one
 * orchestrator's read with another's write) — each orchestrator's
 * hasActiveCycle() asks its own source of truth (a Postgres row, or the
 * Temporal workflow's own execution state). See
 * docs/decisions/0016-temporal-dunning-phase16-scope.md.
 */
@Injectable()
export class DunningListener {
  private readonly logger = new Logger(DunningListener.name);

  constructor(
    @Inject(DUNNING_ORCHESTRATOR) private readonly orchestrator: DunningOrchestrator,
    private readonly postgresFallback: PostgresDunningOrchestrator,
  ) {}

  @OnEvent("payment.failed")
  async onPaymentFailed(event: DomainEvent<"payment.failed", PaymentFailedPayload>): Promise<void> {
    const { paymentId, subscriptionId, recipientId } = event.payload;
    const input: DunningCycleInput = { organizationId: event.organizationId, actorId: recipientId, subscriptionId, paymentId };

    try {
      await this.dispatchFailed(this.orchestrator, input);
    } catch (error) {
      if (this.orchestrator.kind === "in-process") {
        this.logger.error(`Failed to process dunning for failed payment ${paymentId}`, error as Error);
        return;
      }
      this.logger.error("Dunning orchestrator (temporal) failed, falling back to in-process", error as Error);
      try {
        await this.dispatchFailed(this.postgresFallback, input);
      } catch (fallbackError) {
        this.logger.error(`Failed to process dunning for failed payment ${paymentId} (fallback also failed)`, fallbackError as Error);
      }
    }
  }

  @OnEvent("payment.succeeded")
  async onPaymentSucceeded(event: DomainEvent<"payment.succeeded", PaymentSucceededPayload>): Promise<void> {
    const { paymentId, subscriptionId, recipientId } = event.payload;
    const input: DunningCycleInput = { organizationId: event.organizationId, actorId: recipientId, subscriptionId, paymentId };

    try {
      await this.dispatchSucceeded(this.orchestrator, input);
    } catch (error) {
      if (this.orchestrator.kind === "in-process") {
        this.logger.error(`Failed to resolve dunning cycle for succeeded payment ${paymentId}`, error as Error);
        return;
      }
      this.logger.error("Dunning orchestrator (temporal) failed, falling back to in-process", error as Error);
      try {
        await this.dispatchSucceeded(this.postgresFallback, input);
      } catch (fallbackError) {
        this.logger.error(`Failed to resolve dunning cycle for succeeded payment ${paymentId} (fallback also failed)`, fallbackError as Error);
      }
    }
  }

  private async dispatchFailed(orchestrator: DunningOrchestrator, input: DunningCycleInput): Promise<void> {
    const hasActiveCycle = await orchestrator.hasActiveCycle(input.subscriptionId);
    if (hasActiveCycle) {
      await orchestrator.recordAttemptOutcome({ ...input, succeeded: false });
    } else {
      await orchestrator.startDunning(input);
    }
  }

  private async dispatchSucceeded(orchestrator: DunningOrchestrator, input: DunningCycleInput): Promise<void> {
    const hasActiveCycle = await orchestrator.hasActiveCycle(input.subscriptionId);
    if (!hasActiveCycle) return; // no dunning in flight for this subscription — nothing to resolve
    await orchestrator.recordAttemptOutcome({ ...input, succeeded: true });
  }
}
