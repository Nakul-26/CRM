import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { AuditService } from "./audit.service";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@ApiTags("audit-log")
@Controller("audit-log")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions("audit.log.view")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("eventType") eventType?: string,
    @Query("actorId") actorId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const parsedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const parsedOffset = Math.max(Number(offset) || 0, 0);

    return this.audit.list(user.organizationId, {
      eventType,
      actorId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      limit: parsedLimit,
      offset: parsedOffset,
    });
  }
}
