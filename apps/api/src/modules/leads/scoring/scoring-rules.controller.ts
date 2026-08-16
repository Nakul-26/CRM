import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createScoringRuleSchema, updateScoringRuleSchema, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { ScoringRulesService } from "./scoring-rules.service";

@ApiTags("leads")
@Controller("leads/scoring-rules")
export class ScoringRulesController {
  constructor(private readonly rules: ScoringRulesService) {}

  @Get()
  @RequirePermissions("leads.view")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.rules.list(user.organizationId);
  }

  @Post()
  @RequirePermissions("leads.scoring.manage")
  @UsePipes(new ZodValidationPipe(createScoringRuleSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.rules.create(user.organizationId, user.id, body as never);
  }

  @Patch(":id")
  @RequirePermissions("leads.scoring.manage")
  @UsePipes(new ZodValidationPipe(updateScoringRuleSchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.rules.update(user.organizationId, user.id, id, body as never);
  }

  @Delete(":id")
  @RequirePermissions("leads.scoring.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.rules.delete(user.organizationId, user.id, id);
  }
}
