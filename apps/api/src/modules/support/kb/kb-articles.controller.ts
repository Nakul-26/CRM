import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createKbArticleSchema, updateKbArticleSchema, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { KbArticlesService } from "./kb-articles.service";

@ApiTags("kb")
@Controller("kb")
export class KbArticlesController {
  constructor(private readonly kb: KbArticlesService) {}

  @Get()
  @RequirePermissions("support.kb.view")
  list(@CurrentUser() user: AuthenticatedUser, @Query("isPublished") isPublished?: string, @Query("category") category?: string) {
    return this.kb.list(user.organizationId, {
      isPublished: isPublished === undefined ? undefined : isPublished === "true",
      category,
    });
  }

  @Get(":id")
  @RequirePermissions("support.kb.view")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.kb.findById(user.organizationId, id);
  }

  @Post()
  @RequirePermissions("support.kb.create")
  @UsePipes(new ZodValidationPipe(createKbArticleSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.kb.create(user.organizationId, user.id, body as never);
  }

  @Patch(":id")
  @RequirePermissions("support.kb.edit")
  @UsePipes(new ZodValidationPipe(updateKbArticleSchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.kb.update(user.organizationId, user.id, id, body as never);
  }

  @Post(":id/publish")
  @RequirePermissions("support.kb.edit")
  publish(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.kb.setPublished(user.organizationId, user.id, id, true);
  }

  @Post(":id/unpublish")
  @RequirePermissions("support.kb.edit")
  unpublish(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.kb.setPublished(user.organizationId, user.id, id, false);
  }

  @Delete(":id")
  @RequirePermissions("support.kb.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.kb.delete(user.organizationId, user.id, id);
  }
}
