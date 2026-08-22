import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@sales-platform/config";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./providers/payment-provider.interface";
import { MockPaymentProvider } from "./providers/mock-payment.provider";
import { StripePaymentProvider } from "./providers/stripe-payment.provider";
import { DunningActionsService } from "./dunning/dunning-actions.service";
import { DunningListener } from "./dunning/dunning.listener";
import { DunningScheduler } from "./dunning/dunning.scheduler";
import { TemporalWorkerService } from "./dunning/temporal-worker.service";
import { DUNNING_ORCHESTRATOR, type DunningOrchestrator } from "./dunning/orchestrators/dunning-orchestrator.interface";
import { PostgresDunningOrchestrator } from "./dunning/orchestrators/postgres-dunning.orchestrator";
import { TemporalDunningOrchestrator } from "./dunning/orchestrators/temporal-dunning.orchestrator";

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
    DunningActionsService,
    PostgresDunningOrchestrator,
    TemporalDunningOrchestrator,
    {
      provide: DUNNING_ORCHESTRATOR,
      useFactory: (
        config: ConfigService<ApiEnv, true>,
        postgres: PostgresDunningOrchestrator,
        temporal: TemporalDunningOrchestrator,
      ): DunningOrchestrator => (config.get("WORKFLOW_ENGINE", { infer: true }) === "temporal" ? temporal : postgres),
      inject: [ConfigService, PostgresDunningOrchestrator, TemporalDunningOrchestrator],
    },
    DunningListener,
    DunningScheduler,
    TemporalWorkerService,
  ],
})
export class PaymentsModule {}
