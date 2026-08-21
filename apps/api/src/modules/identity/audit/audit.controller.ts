import { Controller, Get, Query, Res, Sse, type MessageEvent } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { Response } from "express";
import { type Observable, fromEvent, interval, merge } from "rxjs";
import { filter, map } from "rxjs/operators";
import { AUDIT_LOG_EXPORT_MAX_ROWS, type AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { RequirePermissions } from "../../../shared/decorators/require-permissions.decorator";
import { assertWithinAuditExportLimit, toAuditCsv } from "./audit-export";
import {
  AUDIT_LOG_ENTRY_CREATED_EVENT,
  matchesAuditStreamFilters,
  type AuditStreamEvent,
  type AuditStreamFilters,
} from "./audit-stream";
import { AuditService } from "./audit.service";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const HEARTBEAT_INTERVAL_MS = 15_000;

@ApiTags("audit-log")
@Controller("audit-log")
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly emitter: EventEmitter2,
  ) {}

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

  @Sse("stream")
  @RequirePermissions("audit.log.view")
  stream(
    @CurrentUser() user: AuthenticatedUser,
    @Query("eventType") eventType?: string,
    @Query("actorId") actorId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
  ): Observable<MessageEvent> {
    const filters: AuditStreamFilters = { eventType, actorId, dateFrom, dateTo };

    const entries$ = fromEvent<AuditStreamEvent>(this.emitter, AUDIT_LOG_ENTRY_CREATED_EVENT).pipe(
      filter((event) => event.organizationId === user.organizationId && matchesAuditStreamFilters(event, filters)),
      map((event) => ({ type: "entry", data: { eventType: event.eventType } }) satisfies MessageEvent),
    );

    const heartbeat$ = interval(HEARTBEAT_INTERVAL_MS).pipe(
      map(() => ({ type: "heartbeat", data: {} }) satisfies MessageEvent),
    );

    return merge(entries$, heartbeat$);
  }
}
