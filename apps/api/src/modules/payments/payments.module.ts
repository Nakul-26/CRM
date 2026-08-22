import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@sales-platform/config";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./providers/payment-provider.interface";
import { MockPaymentProvider } from "./providers/mock-payment.provider";
import { StripePaymentProvider } from "./providers/stripe-payment.provider";

@Module({
  imports: [SubscriptionsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    MockPaymentProvider,
    StripePaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (config: ConfigService<ApiEnv, true>, mock: MockPaymentProvider, stripe: StripePaymentProvider): PaymentProvider =>
        config.get("PAYMENT_PROVIDER", { infer: true }) === "stripe" ? stripe : mock,
      inject: [ConfigService, MockPaymentProvider, StripePaymentProvider],
    },
  ],
})
export class PaymentsModule {}
