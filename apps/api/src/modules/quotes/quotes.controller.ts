import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Res, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import {
  createQuoteSchema,
  createTemplateSchema,
  updateQuoteSchema,
  updateTemplateSchema,
  type AuthenticatedUser,
  type QuoteStatus,
} from "@sales-platform/contracts";
import { CurrentUser } from "../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../shared/pipes/zod-validation.pipe";
import { QuotesService } from "./quotes.service";
import { streamQuotePdf } from "./quote-pdf-response";

@ApiTags("quotes")
@Controller("quotes")
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  // Declared before the generic ":id" routes below so "templates" is never
  // captured as an :id param — same fix already applied in
  // leads.controller.ts / opportunities.controller.ts.
  @Get("templates")
  @RequirePermissions("quotes.view")
  listTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.quotes.listTemplates(user.organizationId);
  }

  @Get("templates/:id")
  @RequirePermissions("quotes.view")
  getTemplate(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.quotes.findTemplate(user.organizationId, id);
  }

  @Post("templates")
  @RequirePermissions("quotes.templates.manage")
  @UsePipes(new ZodValidationPipe(createTemplateSchema))
  createTemplate(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.quotes.createTemplate(user.organizationId, user.id, body as never);
  }

  @Patch("templates/:id")
  @RequirePermissions("quotes.templates.manage")
  @UsePipes(new ZodValidationPipe(updateTemplateSchema))
  updateTemplate(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.quotes.updateTemplate(user.organizationId, user.id, id, body as never);
  }

  @Delete("templates/:id")
  @RequirePermissions("quotes.templates.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeTemplate(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.quotes.deleteTemplate(user.organizationId, user.id, id);
  }

  @Get()
  @RequirePermissions("quotes.view")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: QuoteStatus,
    @Query("accountId") accountId?: string,
    @Query("opportunityId") opportunityId?: string,
  ) {
    return this.quotes.list(user.organizationId, { status, accountId, opportunityId });
  }

  @Post()
  @RequirePermissions("quotes.create")
  @UsePipes(new ZodValidationPipe(createQuoteSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.quotes.create(user.organizationId, user.id, body as never);
  }

  @Get(":id")
  @RequirePermissions("quotes.view")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.quotes.findById(user.organizationId, id);
  }

  @Get(":id/versions")
  @RequirePermissions("quotes.view")
  versions(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.quotes.versions(user.organizationId, id);
  }

  @Patch(":id")
  @RequirePermissions("quotes.edit")
  @UsePipes(new ZodValidationPipe(updateQuoteSchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.quotes.update(user.organizationId, user.id, id, body as never);
  }

  @Delete(":id")
  @RequirePermissions("quotes.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.quotes.delete(user.organizationId, user.id, id);
  }

  @Post(":id/send")
  @RequirePermissions("quotes.send")
  send(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.quotes.send(user.organizationId, user.id, id);
  }

  @Post(":id/revise")
  @RequirePermissions("quotes.edit")
  revise(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.quotes.revise(user.organizationId, user.id, id);
  }

  @Get(":id/pdf")
  @RequirePermissions("quotes.view")
  async pdf(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const snapshot = await this.quotes.pdfSnapshot(user.organizationId, id);
    streamQuotePdf(res, snapshot);
  }

  @Get(":id/versions/:versionNumber/pdf")
  @RequirePermissions("quotes.view")
  async versionPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("versionNumber", ParseIntPipe) versionNumber: number,
    @Res() res: Response,
  ) {
    const snapshot = await this.quotes.pdfSnapshot(user.organizationId, id, versionNumber);
    streamQuotePdf(res, snapshot);
  }
}
