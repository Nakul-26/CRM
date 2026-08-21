import { Controller, Get, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { AUDIT_LOG_EXPORT_MAX_ROWS, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { assertWithinAuditExportLimit, toAuditCsv } from "./audit-export";
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

  @Get("export")
  @RequirePermissions("audit.log.view")
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Query("eventType") eventType?: string,
    @Query("actorId") actorId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
  ) {
    const { items, total } = await this.audit.list(user.organizationId, {
      eventType,
      actorId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      limit: AUDIT_LOG_EXPORT_MAX_ROWS,
      offset: 0,
    });
    assertWithinAuditExportLimit(total);

    const csv = toAuditCsv(items);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit-log-${Date.now()}.csv"`);
    res.send(csv);
  }
}
