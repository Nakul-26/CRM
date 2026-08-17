import { Module } from "@nestjs/common";
import { PlansController } from "./plans/plans.controller";
import { PlansService } from "./plans/plans.service";
import { SubscriptionsController } from "./subscriptions/subscriptions.controller";
import { SubscriptionsService } from "./subscriptions/subscriptions.service";
import { RenewalsService } from "./renewals/renewals.service";
import { RenewalsScheduler } from "./renewals/renewals.scheduler";

@Module({
  controllers: [PlansController, SubscriptionsController],
  providers: [PlansService, SubscriptionsService, RenewalsService, RenewalsScheduler],
  exports: [PlansService, SubscriptionsService, RenewalsService],
})
export class SubscriptionsModule {}
