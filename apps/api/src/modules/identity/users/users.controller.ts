import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { inviteUserSchema, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { UsersService } from "./users.service";

@ApiTags("users")
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions("identity.users.view")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.users.listForOrganization(user.organizationId);
  }

  @Post("invite")
  @RequirePermissions("identity.users.invite")
  @UsePipes(new ZodValidationPipe(inviteUserSchema))
  invite(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.users.invite(user.organizationId, user.id, body as never);
  }

  @Patch(":id/deactivate")
  @RequirePermissions("identity.users.deactivate")
  async deactivate(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.users.deactivate(user.organizationId, id, user.id);
    return { success: true };
  }
}
