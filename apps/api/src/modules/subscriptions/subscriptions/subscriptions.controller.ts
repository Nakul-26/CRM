import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createSubscriptionSchema, updateSubscriptionSchema, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { SubscriptionsService } from "./subscriptions.service";

@ApiTags("subscriptions")
@Controller("subscriptions")
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @RequirePermissions("subscriptions.view")
  list(@CurrentUser() user: AuthenticatedUser, @Query("status") status?: string, @Query("accountId") accountId?: string) {
    return this.subscriptions.list(user.organizationId, { status: status as never, accountId });
  }

  @Get(":id")
  @RequirePermissions("subscriptions.view")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.subscriptions.findById(user.organizationId, id);
  }

  @Post()
  @RequirePermissions("subscriptions.create")
  @UsePipes(new ZodValidationPipe(createSubscriptionSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.subscriptions.create(user.organizationId, user.id, body as never);
  }

  @Patch(":id")
  @RequirePermissions("subscriptions.edit")
  @UsePipes(new ZodValidationPipe(updateSubscriptionSchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.subscriptions.update(user.organizationId, user.id, id, body as never);
  }

  @Post(":id/cancel")
  @RequirePermissions("subscriptions.edit")
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.subscriptions.cancel(user.organizationId, user.id, id);
  }

  @Post(":id/renew")
  @RequirePermissions("subscriptions.edit")
  renew(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.subscriptions.renew(user.organizationId, user.id, id);
  }

  @Delete(":id")
  @RequirePermissions("subscriptions.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.subscriptions.delete(user.organizationId, user.id, id);
  }
}
