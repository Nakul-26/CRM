import { Module } from "@nestjs/common";
import { SlaPoliciesController } from "./sla-policies/sla-policies.controller";
import { SlaPoliciesService } from "./sla-policies/sla-policies.service";
import { TicketsController } from "./tickets/tickets.controller";
import { TicketsService } from "./tickets/tickets.service";
import { InboundEmailController } from "./tickets/inbound-email.controller";
import { InboundEmailService } from "./tickets/inbound-email.service";
import { KbArticlesController } from "./kb/kb-articles.controller";
import { KbArticlesService } from "./kb/kb-articles.service";

@Module({
  controllers: [SlaPoliciesController, TicketsController, InboundEmailController, KbArticlesController],
  providers: [SlaPoliciesService, TicketsService, InboundEmailService, KbArticlesService],
  exports: [SlaPoliciesService, TicketsService, KbArticlesService],
})
export class SupportModule {}
