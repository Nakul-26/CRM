import { Module } from "@nestjs/common";
import { SalesModule } from "../sales/sales.module";
import { LeadsController } from "./leads/leads.controller";
import { LeadsService } from "./leads/leads.service";
import { ScoringRulesController } from "./scoring/scoring-rules.controller";
import { ScoringRulesService } from "./scoring/scoring-rules.service";

@Module({
  imports: [SalesModule],
  controllers: [LeadsController, ScoringRulesController],
  providers: [LeadsService, ScoringRulesService],
})
export class LeadsModule {}
