import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@sales-platform/config";
import type { CheckoutSessionResult, CreateCheckoutSessionInput, PaymentProvider } from "./payment-provider.interface";

/**
 * No network call, no external account — checkoutUrl points at an in-app
 * page (apps/web/src/app/pay/mock/[paymentId]/page.tsx) that simulates a
 * hosted checkout page well enough to exercise the whole flow end-to-end in
 * dev/test. Default provider (PAYMENT_PROVIDER=mock).
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly kind = "mock" as const;

  constructor(private readonly config: ConfigService<ApiEnv, true>) {}

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult> {
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    return {
      checkoutUrl: `${webAppUrl}/pay/mock/${input.paymentId}`,
      providerRef: randomUUID(),
    };
  }
}
