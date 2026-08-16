import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  createOpportunitySchema,
  moveOpportunityStageSchema,
  updateOpportunitySchema,
  type AuthenticatedUser,
} from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { OpportunitiesService } from "./opportunities.service";

@ApiTags("opportunities")
@Controller("opportunities")
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get("stats/summary")
  @RequirePermissions("opportunities.view")
  summaryStats(@CurrentUser() user: AuthenticatedUser) {
    return this.opportunities.summaryStats(user.organizationId);
  }

  @Get("stats/forecast")
  @RequirePermissions("opportunities.view")
  forecast(@CurrentUser() user: AuthenticatedUser) {
    return this.opportunities.forecastByMonth(user.organizationId);
  }

  @Get()
  @RequirePermissions("opportunities.view")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("pipelineId") pipelineId?: string,
    @Query("stageId") stageId?: string,
    @Query("ownerId") ownerId?: string,
    @Query("outcome") outcome?: string,
  ) {
    return this.opportunities.list(user.organizationId, { pipelineId, stageId, ownerId, outcome });
  }

  @Get(":id")
  @RequirePermissions("opportunities.view")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.opportunities.findById(user.organizationId, id);
  }

  @Get(":id/stage-history")
  @RequirePermissions("opportunities.view")
  stageHistory(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.opportunities.stageHistory(user.organizationId, id);
  }

  @Post()
  @RequirePermissions("opportunities.create")
  @UsePipes(new ZodValidationPipe(createOpportunitySchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.opportunities.create(user.organizationId, user.id, body as never);
  }

  @Patch(":id")
  @RequirePermissions("opportunities.edit")
  @UsePipes(new ZodValidationPipe(updateOpportunitySchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.opportunities.update(user.organizationId, user.id, id, body as never);
  }

  @Delete(":id")
  @RequirePermissions("opportunities.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.opportunities.delete(user.organizationId, user.id, id);
  }

  @Post(":id/stage")
  @RequirePermissions("opportunities.edit")
  @UsePipes(new ZodValidationPipe(moveOpportunityStageSchema))
  moveStage(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.opportunities.moveStage(user.organizationId, user.id, id, body as never);
  }
}
