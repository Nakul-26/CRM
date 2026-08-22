import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import { StripePaymentProvider } from "./stripe-payment.provider";

function makeConfig(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] } as unknown as ConfigService<never, true>;
}

// A real Stripe client, used only to sign a payload locally — no network
// call. Lets webhook-signature verification be tested for real without
// live/test API credentials (createCheckoutSession's actual network call
// cannot be — see docs/decisions/0013-payment-processing-phase13-scope.md).
const webhookSecret = "whsec_test_secret";
const stripeForSigning = new Stripe("sk_test_unused_key_signing_is_local_only");

describe("StripePaymentProvider", () => {
  describe("createCheckoutSession", () => {
    it("builds the expected session params and maps the response, with no real network call", async () => {
      const create = jest.fn().mockResolvedValue({ id: "cs_test_123", url: "https://checkout.stripe.com/pay/cs_test_123" });

      const provider = new StripePaymentProvider(
        makeConfig({ STRIPE_SECRET_KEY: "sk_test_123", WEB_APP_URL: "http://localhost:3000" }),
      );
      // The Stripe client is built lazily inside the provider (see its
      // class comment); `client` is TypeScript-private only, so swapping it
      // out here for a stub avoids both a real network call and mocking the
      // whole `stripe` module (which would also break the genuinely-signed
      // webhook tests below, which need the real SDK).
      (provider as unknown as { client: unknown }).client = { checkout: { sessions: { create } } };

      const result = await provider.createCheckoutSession({
        paymentId: "22222222-2222-2222-2222-222222222222",
        amount: 49,
        currency: "usd",
        description: "Renewal — Pro",
      });

      expect(result).toEqual({ checkoutUrl: "https://checkout.stripe.com/pay/cs_test_123", providerRef: "cs_test_123" });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "payment",
          success_url: "http://localhost:3000/subscriptions?payment=success",
          cancel_url: "http://localhost:3000/subscriptions?payment=cancelled",
          metadata: { paymentId: "22222222-2222-2222-2222-222222222222" },
          line_items: [
            expect.objectContaining({
              quantity: 1,
              price_data: expect.objectContaining({ currency: "usd", unit_amount: 4900 }),
            }),
          ],
        }),
      );
    });

    it("throws if PAYMENT_PROVIDER=stripe but STRIPE_SECRET_KEY is missing", async () => {
      const provider = new StripePaymentProvider(makeConfig({ WEB_APP_URL: "http://localhost:3000" }));
      await expect(
        provider.createCheckoutSession({ paymentId: "x", amount: 1, currency: "usd", description: "x" }),
      ).rejects.toThrow(/STRIPE_SECRET_KEY/);
    });
  });

  describe("verifyWebhookSignature", () => {
    it("accepts a genuinely valid signature (real local HMAC, no network)", () => {
      const provider = new StripePaymentProvider(makeConfig({ STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: webhookSecret }));
      const payload = JSON.stringify({ id: "evt_test", type: "checkout.session.completed" });
      const header = stripeForSigning.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

      const event = provider.verifyWebhookSignature(Buffer.from(payload), header);
      expect(event.type).toBe("checkout.session.completed");
    });

    it("rejects a tampered payload", () => {
      const provider = new StripePaymentProvider(makeConfig({ STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: webhookSecret }));
      const payload = JSON.stringify({ id: "evt_test", type: "checkout.session.completed" });
      const header = stripeForSigning.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

      expect(() => provider.verifyWebhookSignature(Buffer.from(payload + "tampered"), header)).toThrow();
    });

    it("throws if STRIPE_WEBHOOK_SECRET is missing", () => {
      const provider = new StripePaymentProvider(makeConfig({ STRIPE_SECRET_KEY: "sk_test_123" }));
      expect(() => provider.verifyWebhookSignature(Buffer.from("{}"), "t=1,v1=abc")).toThrow(/STRIPE_WEBHOOK_SECRET/);
    });

    it("verifies a genuine signature even with no STRIPE_SECRET_KEY configured at all (default mock-provider setup)", () => {
      const provider = new StripePaymentProvider(makeConfig({ STRIPE_WEBHOOK_SECRET: webhookSecret }));
      const payload = JSON.stringify({ id: "evt_test", type: "checkout.session.completed" });
      const header = stripeForSigning.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

      const event = provider.verifyWebhookSignature(Buffer.from(payload), header);
      expect(event.type).toBe("checkout.session.completed");
    });
  });
});
