import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  assignTicketSchema,
  createTicketCommentSchema,
  createTicketSchema,
  updateTicketSchema,
  updateTicketStatusSchema,
  type AuthenticatedUser,
} from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../../shared/pipes/zod-validation.pipe";
import { TicketsService } from "./tickets.service";

@ApiTags("tickets")
@Controller("tickets")
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  @RequirePermissions("support.tickets.view")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: string,
    @Query("priority") priority?: string,
    @Query("assigneeId") assigneeId?: string,
  ) {
    return this.tickets.list(user.organizationId, { status: status as never, priority, assigneeId });
  }

  @Get(":id")
  @RequirePermissions("support.tickets.view")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.tickets.findById(user.organizationId, id);
  }

  @Get(":id/comments")
  @RequirePermissions("support.tickets.view")
  listComments(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.tickets.listComments(user.organizationId, id);
  }

  @Post()
  @RequirePermissions("support.tickets.create")
  @UsePipes(new ZodValidationPipe(createTicketSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.tickets.create(user.organizationId, user.id, body as never);
  }

  @Patch(":id")
  @RequirePermissions("support.tickets.edit")
  @UsePipes(new ZodValidationPipe(updateTicketSchema))
  update(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tickets.update(user.organizationId, user.id, id, body as never);
  }

  @Post(":id/status")
  @RequirePermissions("support.tickets.edit")
  @UsePipes(new ZodValidationPipe(updateTicketStatusSchema))
  updateStatus(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { status } = body as { status: never };
    return this.tickets.updateStatus(user.organizationId, user.id, id, status);
  }

  @Post(":id/assign")
  @RequirePermissions("support.tickets.manage")
  @UsePipes(new ZodValidationPipe(assignTicketSchema))
  assign(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tickets.assign(user.organizationId, user.id, id, body as never);
  }

  @Post(":id/comments")
  @RequirePermissions("support.tickets.edit")
  @UsePipes(new ZodValidationPipe(createTicketCommentSchema))
  addComment(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tickets.addComment(user.organizationId, user.id, id, body as never);
  }

  @Delete(":id")
  @RequirePermissions("support.tickets.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.tickets.delete(user.organizationId, user.id, id);
  }
}
