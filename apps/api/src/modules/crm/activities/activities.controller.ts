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
import { createActivitySchema, updateActivitySchema, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { ActivitiesService } from "./activities.service";

@ApiTags("activities")
@Controller("activities")
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @RequirePermissions("crm.activities.view")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("accountId") accountId?: string,
    @Query("contactId") contactId?: string,
    @Query("type") type?: string,
  ) {
    return this.activities.list(user.organizationId, { accountId, contactId, type });
  }

  @Get(":id")
  @RequirePermissions("crm.activities.view")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.activities.findById(user.organizationId, id);
  }

  @Post()
  @RequirePermissions("crm.activities.create")
  @UsePipes(new ZodValidationPipe(createActivitySchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.activities.create(user.organizationId, user.id, body as never);
  }

  @Patch(":id")
  @RequirePermissions("crm.activities.edit")
  @UsePipes(new ZodValidationPipe(updateActivitySchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.activities.update(user.organizationId, user.id, id, body as never);
  }

  @Delete(":id")
  @RequirePermissions("crm.activities.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.activities.delete(user.organizationId, user.id, id);
  }
}
