import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { TimelineService } from "./timeline.service";

@ApiTags("timeline")
@Controller("accounts")
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get(":id/timeline")
  @RequirePermissions("crm.accounts.view")
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("type") type?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("before") before?: string,
    @Query("limit") limit?: string,
  ) {
    return this.timeline.forAccount(user.organizationId, id, {
      type,
      from,
      to,
      before,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
