import { Module } from "@nestjs/common";
import { PipelinesController } from "./pipelines/pipelines.controller";
import { PipelinesService } from "./pipelines/pipelines.service";
import { OpportunitiesController } from "./opportunities/opportunities.controller";
import { OpportunitiesService } from "./opportunities/opportunities.service";

@Module({
  controllers: [PipelinesController, OpportunitiesController],
  providers: [PipelinesService, OpportunitiesService],
  exports: [PipelinesService, OpportunitiesService],
})
export class SalesModule {}
