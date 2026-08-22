import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { ERROR_CODES, type MockPaymentViewDto, type PaymentStatus } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../database/database.module";
import { payments } from "../../database/schema";
import { DomainEventBus } from "../../shared/events/domain-event-bus";
import { SubscriptionsService } from "../subscriptions/subscriptions/subscriptions.service";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./providers/payment-provider.interface";
import { StripePaymentProvider } from "./providers/stripe-payment.provider";

type PaymentRow = typeof payments.$inferSelect;

function serialize(row: PaymentRow) {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status as PaymentStatus,
    provider: row.provider as "mock" | "stripe",
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

/**
 * Starts/completes paid subscription renewals. The existing free
 * SubscriptionsService.renew() is untouched — this calls it internally once
 * a payment succeeds, so renewal side effects (period math, reminder
 * scheduling, subscription.renewed) stay one source of truth regardless of
 * whether renewal was free or paid. See
 * docs/decisions/0013-payment-processing-phase13-scope.md.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
    private readonly subscriptions: SubscriptionsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly stripeProvider: StripePaymentProvider,
  ) {}

  async startCheckout(organizationId: string, actorId: string, subscriptionId: string) {
    const subscription = await this.subscriptions.getForCharge(organizationId, subscriptionId);
    if (subscription.status === "cancelled") {
      throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: "Cannot start a checkout for a cancelled subscription" });
    }

    const description = `Renewal — ${subscription.planName}`;
    const [payment] = await this.db
      .insert(payments)
      .values({
        organizationId,
        subscriptionId,
        amount: subscription.price,
        currency: "usd",
        description,
        provider: this.provider.kind,
        createdBy: actorId,
      })
      .returning();

    const { checkoutUrl, providerRef } = await this.provider.createCheckoutSession({
      paymentId: payment.id,
      amount: Number(subscription.price),
      currency: "usd",
      description,
    });

    await this.db.update(payments).set({ providerRef }).where(eq(payments.id, payment.id));

    this.events.publish({
      eventType: "payment.checkout_started",
      organizationId,
      actorId,
      payload: { paymentId: payment.id, subscriptionId, accountId: subscription.accountId },
    });

    return { paymentId: payment.id, checkoutUrl };
  }

  async handleSucceeded(paymentId: string, providerRef?: string): Promise<void> {
    const payment = await this.getRawPayment(paymentId);
    if (payment.status !== "pending") return; // idempotent: at-least-once webhook delivery / double-click

    await this.db
      .update(payments)
      .set({ status: "succeeded", completedAt: new Date(), providerRef: providerRef ?? payment.providerRef })
      .where(eq(payments.id, paymentId));

    const subscription = await this.subscriptions.renew(payment.organizationId, payment.createdBy, payment.subscriptionId);

    this.events.publish({
      eventType: "payment.succeeded",
      organizationId: payment.organizationId,
      actorId: payment.createdBy,
      payload: {
        paymentId,
        subscriptionId: payment.subscriptionId,
        accountId: subscription.accountId,
        amount: Number(payment.amount),
        recipientId: payment.createdBy,
      },
    });
  }

  async handleFailed(paymentId: string, reason?: string): Promise<void> {
    const payment = await this.getRawPayment(paymentId);
    if (payment.status !== "pending") return; // idempotent, same reasoning as handleSucceeded

    await this.db
      .update(payments)
      .set({ status: "failed", completedAt: new Date(), failureReason: reason ?? null })
      .where(eq(payments.id, paymentId));

    this.events.publish({
      eventType: "payment.failed",
      organizationId: payment.organizationId,
      actorId: payment.createdBy,
      payload: {
        paymentId,
        subscriptionId: payment.subscriptionId,
        recipientId: payment.createdBy,
      },
    });
  }

  /** Verifies the Stripe signature against the raw body, then routes to the same handleSucceeded/handleFailed the mock path uses. */
  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: ReturnType<StripePaymentProvider["verifyWebhookSignature"]>;
    try {
      event = this.stripeProvider.verifyWebhookSignature(rawBody, signature);
    } catch {
      throw new BadRequestException("Invalid Stripe webhook signature");
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as { metadata?: Record<string, string> | null; id: string };
      const paymentId = session.metadata?.paymentId;
      if (paymentId) await this.handleSucceeded(paymentId, session.id);
    } else if (event.type === "checkout.session.expired") {
      const session = event.data.object as { metadata?: Record<string, string> | null };
      const paymentId = session.metadata?.paymentId;
      if (paymentId) await this.handleFailed(paymentId, "Checkout session expired");
    }
  }

  /** Curated for the public, payment-id-scoped mock checkout page — no organizationId/account data. */
  async getMockView(paymentId: string): Promise<MockPaymentViewDto> {
    const payment = await this.getRawPayment(paymentId);
    if (payment.provider !== "mock") {
      throw new BadRequestException("This payment is not using the mock provider");
    }
    return {
      id: payment.id,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status as PaymentStatus,
      description: payment.description,
    };
  }

  async completeMock(paymentId: string): Promise<void> {
    const payment = await this.getRawPayment(paymentId);
    if (payment.provider !== "mock") throw new BadRequestException("This payment is not using the mock provider");
    await this.handleSucceeded(paymentId);
  }

  async failMock(paymentId: string): Promise<void> {
    const payment = await this.getRawPayment(paymentId);
    if (payment.provider !== "mock") throw new BadRequestException("This payment is not using the mock provider");
    await this.handleFailed(paymentId, "Cancelled at mock checkout");
  }

  async listForSubscription(organizationId: string, subscriptionId: string) {
    const rows = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.organizationId, organizationId), eq(payments.subscriptionId, subscriptionId)))
      .orderBy(desc(payments.createdAt));
    return rows.map(serialize);
  }

  private async getRawPayment(paymentId: string): Promise<PaymentRow> {
    const [payment] = await this.db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
    return payment;
  }
}
