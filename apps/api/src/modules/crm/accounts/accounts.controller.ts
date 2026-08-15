import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createAccountSchema, updateAccountSchema, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { AccountsService } from "./accounts.service";

@ApiTags("accounts")
@Controller("accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermissions("crm.accounts.view")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.list(user.organizationId);
  }

  @Get(":id")
  @RequirePermissions("crm.accounts.view")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.accounts.findById(user.organizationId, id);
  }

  @Post()
  @RequirePermissions("crm.accounts.create")
  @UsePipes(new ZodValidationPipe(createAccountSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.accounts.create(user.organizationId, user.id, body as never);
  }

  @Patch(":id")
  @RequirePermissions("crm.accounts.edit")
  @UsePipes(new ZodValidationPipe(updateAccountSchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.accounts.update(user.organizationId, user.id, id, body as never);
  }

  @Delete(":id")
  @RequirePermissions("crm.accounts.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.accounts.delete(user.organizationId, user.id, id);
  }
}
