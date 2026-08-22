import { Injectable } from "@nestjs/common";
import { SubscriptionsService } from "../../subscriptions/subscriptions/subscriptions.service";
import { PaymentsService } from "../payments.service";

/**
 * The only business logic a dunning attempt/exhaustion actually performs —
 * shared by the Postgres cron poller and the Temporal activities, so
 * neither backend duplicates it. See
 * docs/decisions/0016-temporal-dunning-phase16-scope.md.
 */
@Injectable()
export class DunningActionsService {
  constructor(
    private readonly payments: PaymentsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Starts a fresh checkout attempt for the subscription — safely
   * re-invokable (PaymentsService.startCheckout creates a new payment row
   * each call). The outcome (succeeded/failed) resolves later, async, via
   * the normal payment.succeeded/payment.failed event flow (mock checkout
   * completion or a Stripe webhook) — never synchronously from this call.
   */
  async attemptCharge(organizationId: string, actorId: string, subscriptionId: string): Promise<{ paymentId: string }> {
    const { paymentId } = await this.payments.startCheckout(organizationId, actorId, subscriptionId);
    return { paymentId };
  }

  async cancelSubscription(organizationId: string, actorId: string, subscriptionId: string): Promise<void> {
    await this.subscriptions.cancel(organizationId, actorId, subscriptionId);
  }
}
