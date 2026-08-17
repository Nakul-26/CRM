import { Module } from "@nestjs/common";
import { SlaPoliciesController } from "./sla-policies/sla-policies.controller";
import { SlaPoliciesService } from "./sla-policies/sla-policies.service";
import { TicketsController } from "./tickets/tickets.controller";
import { TicketsService } from "./tickets/tickets.service";
import { KbArticlesController } from "./kb/kb-articles.controller";
import { KbArticlesService } from "./kb/kb-articles.service";

@Module({
  controllers: [SlaPoliciesController, TicketsController, KbArticlesController],
  providers: [SlaPoliciesService, TicketsService, KbArticlesService],
  exports: [SlaPoliciesService, TicketsService, KbArticlesService],
})
export class SupportModule {}
