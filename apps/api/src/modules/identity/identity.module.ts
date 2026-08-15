import { Module } from "@nestjs/common";
import { OrganizationsService } from "./organizations/organizations.service";
import { UsersService } from "./users/users.service";
import { UsersController } from "./users/users.controller";
import { RolesService } from "./roles/roles.service";
import { RolesController } from "./roles/roles.controller";
import { TeamsService } from "./teams/teams.service";
import { TeamsController } from "./teams/teams.controller";
import { AuthService } from "./auth/auth.service";
import { AuthController } from "./auth/auth.controller";
import { PasswordService } from "./auth/password.service";

@Module({
  controllers: [AuthController, UsersController, RolesController, TeamsController],
  providers: [OrganizationsService, UsersService, RolesService, TeamsService, AuthService, PasswordService],
  exports: [RolesService, UsersService, OrganizationsService],
})
export class IdentityModule {}
