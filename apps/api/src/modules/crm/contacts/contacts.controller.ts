import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UsePipes,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createContactSchema, updateContactSchema, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { ContactsService } from "./contacts.service";

@ApiTags("contacts")
@Controller("contacts")
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermissions("crm.contacts.view")
  list(@CurrentUser() user: AuthenticatedUser, @Query("accountId") accountId?: string) {
    return this.contacts.list(user.organizationId, accountId);
  }

  @Get(":id")
  @RequirePermissions("crm.contacts.view")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.contacts.findById(user.organizationId, id);
  }

  @Post()
  @RequirePermissions("crm.contacts.create")
  @UsePipes(new ZodValidationPipe(createContactSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.contacts.create(user.organizationId, user.id, body as never);
  }

  @Patch(":id")
  @RequirePermissions("crm.contacts.edit")
  @UsePipes(new ZodValidationPipe(updateContactSchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.contacts.update(user.organizationId, user.id, id, body as never);
  }

  @Delete(":id")
  @RequirePermissions("crm.contacts.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.contacts.delete(user.organizationId, user.id, id);
  }
}
