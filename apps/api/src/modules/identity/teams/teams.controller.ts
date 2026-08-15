import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createTeamSchema, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { TeamsService } from "./teams.service";

@ApiTags("teams")
@Controller("teams")
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermissions("identity.teams.view")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.teams.listForOrganization(user.organizationId);
  }

  @Post()
  @RequirePermissions("identity.teams.manage")
  @UsePipes(new ZodValidationPipe(createTeamSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.teams.create(user.organizationId, body as never);
  }

  @Post(":teamId/members/:userId")
  @RequirePermissions("identity.teams.manage")
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("teamId", ParseUUIDPipe) teamId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    return this.teams.addMember(user.organizationId, teamId, userId);
  }

  @Delete(":teamId/members/:userId")
  @RequirePermissions("identity.teams.manage")
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("teamId", ParseUUIDPipe) teamId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    return this.teams.removeMember(user.organizationId, teamId, userId);
  }
}
