export interface CreateCheckoutSessionInput {
  paymentId: string;
  amount: number;
  currency: string;
  description: string;
}

export interface CheckoutSessionResult {
  checkoutUrl: string;
  providerRef: string;
}

/**
 * One interface, two implementations — MockPaymentProvider (no network,
 * used by default) and StripePaymentProvider (real Stripe Checkout,
 * opt-in via PAYMENT_PROVIDER=stripe). See
 * docs/decisions/0013-payment-processing-phase13-scope.md.
 */
export interface PaymentProvider {
  readonly kind: "mock" | "stripe";
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult>;
}

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");
