import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import type { AuditLogEntryDto, AuditLogPageDto } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { auditLog, users } from "../../../database/schema";

export interface AuditLogFilters {
  eventType?: string;
  actorId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit: number;
  offset: number;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async list(organizationId: string, filters: AuditLogFilters): Promise<AuditLogPageDto> {
    const conditions = [eq(auditLog.organizationId, organizationId)];
    if (filters.eventType) conditions.push(eq(auditLog.eventType, filters.eventType));
    if (filters.actorId) conditions.push(eq(auditLog.actorId, filters.actorId));
    if (filters.dateFrom) conditions.push(gte(auditLog.createdAt, filters.dateFrom));
    if (filters.dateTo) conditions.push(lte(auditLog.createdAt, filters.dateTo));
    const where = and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          id: auditLog.id,
          eventType: auditLog.eventType,
          actorId: auditLog.actorId,
          payload: auditLog.payload,
          ip: auditLog.ip,
          userAgent: auditLog.userAgent,
          createdAt: auditLog.createdAt,
          actorName: users.fullName,
          actorEmail: users.email,
        })
        .from(auditLog)
        .leftJoin(users, eq(auditLog.actorId, users.id))
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(filters.limit)
        .offset(filters.offset),
      this.db.select({ total: count() }).from(auditLog).where(where),
    ]);

    const items: AuditLogEntryDto[] = rows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      actorId: row.actorId,
      actorName: row.actorName ?? null,
      actorEmail: row.actorEmail ?? null,
      payload: row.payload ?? null,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total };
  }
}
