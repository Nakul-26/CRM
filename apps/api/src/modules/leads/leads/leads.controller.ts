import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createLeadSchema, qualifyLeadSchema, updateLeadSchema, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { LeadsService } from "./leads.service";

@ApiTags("leads")
@Controller("leads")
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get("duplicates")
  @RequirePermissions("leads.view")
  duplicates(@CurrentUser() user: AuthenticatedUser, @Query("email") email?: string, @Query("company") company?: string) {
    return this.leads.duplicates(user.organizationId, email, company);
  }

  @Get("stats/by-source")
  @RequirePermissions("leads.view")
  statsBySource(@CurrentUser() user: AuthenticatedUser) {
    return this.leads.statsBySource(user.organizationId);
  }

  @Get()
  @RequirePermissions("leads.view")
  list(@CurrentUser() user: AuthenticatedUser, @Query("status") status?: string) {
    return this.leads.list(user.organizationId, status);
  }

  @Get(":id")
  @RequirePermissions("leads.view")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.leads.findById(user.organizationId, id);
  }

  @Post()
  @RequirePermissions("leads.create")
  @UsePipes(new ZodValidationPipe(createLeadSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.leads.create(user.organizationId, user.id, body as never);
  }

  @Patch(":id")
  @RequirePermissions("leads.edit")
  @UsePipes(new ZodValidationPipe(updateLeadSchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.leads.update(user.organizationId, user.id, id, body as never);
  }

  @Delete(":id")
  @RequirePermissions("leads.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.leads.delete(user.organizationId, user.id, id);
  }

  @Post(":id/recalculate-score")
  @RequirePermissions("leads.edit")
  recalculateScore(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.leads.recalculateScore(user.organizationId, user.id, id);
  }

  @Post(":id/contact")
  @RequirePermissions("leads.edit")
  markContacted(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.leads.markContacted(user.organizationId, user.id, id);
  }

  @Post(":id/qualify")
  @RequirePermissions("leads.edit")
  @UsePipes(new ZodValidationPipe(qualifyLeadSchema))
  qualify(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { outcome } = body as { outcome: "qualified" | "unqualified" };
    return this.leads.qualify(user.organizationId, user.id, id, outcome);
  }

  @Post(":id/convert")
  @RequirePermissions("leads.convert")
  convert(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.leads.convert(user.organizationId, user.id, id);
  }
}
