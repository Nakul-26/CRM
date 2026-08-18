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
import { AuditService } from "./audit/audit.service";
import { AuditController } from "./audit/audit.controller";

@Module({
  controllers: [AuthController, UsersController, RolesController, TeamsController, AuditController],
  providers: [OrganizationsService, UsersService, RolesService, TeamsService, AuthService, PasswordService, AuditService],
  exports: [RolesService, UsersService, OrganizationsService],
})
export class IdentityModule {}
