import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../shared/decorators/current-user.decorator";
import { JwtAuthGuard } from "../shared/guards/jwt-auth.guard";
import { NotificationsService } from "./notifications.service";

/**
 * Ported from apps/api/src/modules/notifications/notifications.controller.ts
 * (Phase 18). No `@RequirePermissions` here either — every route is scoped
 * to the caller's own userId, so authentication alone is the right gate,
 * same as it was in the monolith. Mounted at global prefix `api/v1` (see
 * main.ts), so the full path matches exactly what apps/web's gateway
 * already forwards: `/api/v1/notifications`.
 */
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("unreadOnly") unreadOnly?: string) {
    return this.notifications.list(user.organizationId, user.id, { unreadOnly: unreadOnly === "true" });
  }

  @Get("unread-count")
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.notifications.unreadCount(user.organizationId, user.id);
    return { count };
  }

  @Patch(":id/read")
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user.organizationId, user.id, id);
  }

  @Post("read-all")
  @HttpCode(HttpStatus.NO_CONTENT)
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.organizationId, user.id);
  }
}
