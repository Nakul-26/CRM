import { Module } from "@nestjs/common";
import { PipelinesController } from "./pipelines/pipelines.controller";
import { PipelinesService } from "./pipelines/pipelines.service";
import { OpportunitiesController } from "./opportunities/opportunities.controller";
import { OpportunitiesService } from "./opportunities/opportunities.service";
import { QuoteAcceptedListener } from "./automation/quote-accepted.listener";

@Module({
  controllers: [PipelinesController, OpportunitiesController],
  providers: [PipelinesService, OpportunitiesService, QuoteAcceptedListener],
  exports: [PipelinesService, OpportunitiesService],
})
export class SalesModule {}
