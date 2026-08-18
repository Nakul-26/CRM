import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../shared/decorators/current-user.decorator";
import { NotificationsService } from "./notifications.service";

/**
 * No `@RequirePermissions` anywhere here — every route is scoped to the
 * caller's own userId, so authentication alone is the right gate, same
 * precedent as `GET /auth/me`. See
 * docs/decisions/0009-notifications-phase9-scope.md.
 */
@ApiTags("notifications")
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
