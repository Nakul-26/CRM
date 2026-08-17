import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createPlanSchema, updatePlanSchema, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { PlansService } from "./plans.service";

@ApiTags("plans")
@Controller("plans")
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @RequirePermissions("subscriptions.view")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.plans.list(user.organizationId);
  }

  @Get(":id")
  @RequirePermissions("subscriptions.view")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.plans.findById(user.organizationId, id);
  }

  @Post()
  @RequirePermissions("subscriptions.manage")
  @UsePipes(new ZodValidationPipe(createPlanSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.plans.create(user.organizationId, user.id, body as never);
  }

  @Patch(":id")
  @RequirePermissions("subscriptions.manage")
  @UsePipes(new ZodValidationPipe(updatePlanSchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.plans.update(user.organizationId, user.id, id, body as never);
  }

  @Delete(":id")
  @RequirePermissions("subscriptions.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.plans.delete(user.organizationId, user.id, id);
  }
}
