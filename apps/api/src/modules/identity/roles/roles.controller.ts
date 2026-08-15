import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createRoleSchema, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { RolesService } from "./roles.service";

@ApiTags("roles")
@Controller("roles")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions("identity.roles.view")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.roles.listForOrganization(user.organizationId);
  }

  @Post()
  @RequirePermissions("identity.roles.manage")
  @UsePipes(new ZodValidationPipe(createRoleSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.roles.create(user.organizationId, body as never);
  }

  @Post(":roleId/users/:userId")
  @RequirePermissions("identity.roles.manage")
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param("roleId", ParseUUIDPipe) roleId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    return this.roles.assignToUser(user.organizationId, user.id, userId, roleId);
  }

  @Delete(":roleId/users/:userId")
  @RequirePermissions("identity.roles.manage")
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param("roleId", ParseUUIDPipe) roleId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    return this.roles.revokeFromUser(user.organizationId, user.id, userId, roleId);
  }
}
