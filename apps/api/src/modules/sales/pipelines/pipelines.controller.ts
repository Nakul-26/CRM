import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  createPipelineSchema,
  createStageSchema,
  updatePipelineSchema,
  updateStageSchema,
  type AuthenticatedUser,
} from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { PipelinesService } from "./pipelines.service";

@ApiTags("pipelines")
@Controller("pipelines")
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Get()
  @RequirePermissions("opportunities.view")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.pipelines.list(user.organizationId);
  }

  @Get(":id")
  @RequirePermissions("opportunities.view")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.pipelines.findById(user.organizationId, id);
  }

  @Get(":id/stages")
  @RequirePermissions("opportunities.view")
  stages(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.pipelines.stagesFor(user.organizationId, id);
  }

  @Post()
  @RequirePermissions("opportunities.pipelines.manage")
  @UsePipes(new ZodValidationPipe(createPipelineSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.pipelines.create(user.organizationId, user.id, body as never);
  }

  @Patch(":id")
  @RequirePermissions("opportunities.pipelines.manage")
  @UsePipes(new ZodValidationPipe(updatePipelineSchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.pipelines.update(user.organizationId, user.id, id, body as never);
  }

  @Delete(":id")
  @RequirePermissions("opportunities.pipelines.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.pipelines.delete(user.organizationId, user.id, id);
  }

  @Post(":pipelineId/stages")
  @RequirePermissions("opportunities.pipelines.manage")
  @UsePipes(new ZodValidationPipe(createStageSchema))
  createStage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("pipelineId", ParseUUIDPipe) pipelineId: string,
    @Body() body: unknown,
  ) {
    return this.pipelines.createStage(user.organizationId, user.id, pipelineId, body as never);
  }

  @Patch(":pipelineId/stages/:stageId")
  @RequirePermissions("opportunities.pipelines.manage")
  @UsePipes(new ZodValidationPipe(updateStageSchema))
  updateStage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("pipelineId", ParseUUIDPipe) pipelineId: string,
    @Param("stageId", ParseUUIDPipe) stageId: string,
    @Body() body: unknown,
  ) {
    return this.pipelines.updateStage(user.organizationId, user.id, pipelineId, stageId, body as never);
  }

  @Delete(":pipelineId/stages/:stageId")
  @RequirePermissions("opportunities.pipelines.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeStage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("pipelineId", ParseUUIDPipe) pipelineId: string,
    @Param("stageId", ParseUUIDPipe) stageId: string,
  ) {
    await this.pipelines.deleteStage(user.organizationId, user.id, pipelineId, stageId);
  }
}
