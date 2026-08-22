import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import type { ApiEnv } from "@sales-platform/config";
import type { CheckoutSessionResult, CreateCheckoutSessionInput, PaymentProvider } from "./payment-provider.interface";

/**
 * Real Stripe Checkout integration, opt-in via PAYMENT_PROVIDER=stripe. The
 * Stripe client is built lazily (not in the constructor) so this class can
 * always be registered for DI — including the webhook route's use of
 * verifyWebhookSignature — without breaking app startup when running with
 * the default mock provider and no Stripe keys configured at all. No
 * automated test in this repo exercises the actual network call (no
 * live/test Stripe API key is available in this environment) — verified
 * only via a mocked-client unit test and type-checking. See
 * docs/decisions/0013-payment-processing-phase13-scope.md.
 */
@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly kind = "stripe" as const;

  private client: Stripe | undefined;
  private webhookClient: Stripe | undefined;

  constructor(private readonly config: ConfigService<ApiEnv, true>) {}

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult> {
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const session = await this.getClient().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: input.currency,
            product_data: { name: input.description },
            unit_amount: Math.round(input.amount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${webAppUrl}/subscriptions?payment=success`,
      cancel_url: `${webAppUrl}/subscriptions?payment=cancelled`,
      metadata: { paymentId: input.paymentId },
    });

    if (!session.url) {
      throw new InternalServerErrorException("Stripe did not return a checkout URL");
    }
    return { checkoutUrl: session.url, providerRef: session.id };
  }

  /**
   * Pure, local signature verification — no network call, so it doesn't need
   * a real STRIPE_SECRET_KEY (only the SDK's checkout/API calls do). Uses its
   * own placeholder-keyed client for this reason. Throws
   * Stripe.errors.StripeSignatureVerificationError on mismatch.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string): Stripe.Event {
    const webhookSecret = this.config.get("STRIPE_WEBHOOK_SECRET", { infer: true });
    if (!webhookSecret) {
      throw new InternalServerErrorException("PAYMENT_PROVIDER=stripe requires STRIPE_WEBHOOK_SECRET to be set");
    }
    return this.getWebhookClient().webhooks.constructEvent(rawBody, signature, webhookSecret);
  }

  private getClient(): Stripe {
    if (this.client) return this.client;
    const secretKey = this.config.get("STRIPE_SECRET_KEY", { infer: true });
    if (!secretKey) {
      throw new InternalServerErrorException("PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY to be set");
    }
    this.client = new Stripe(secretKey);
    return this.client;
  }

  private getWebhookClient(): Stripe {
    if (this.webhookClient) return this.webhookClient;
    const secretKey = this.config.get("STRIPE_SECRET_KEY", { infer: true }) ?? "sk_test_placeholder_webhook_signature_verification_only";
    this.webhookClient = new Stripe(secretKey);
    return this.webhookClient;
  }
}
