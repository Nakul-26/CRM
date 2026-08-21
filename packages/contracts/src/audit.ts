export interface AuditLogEntryDto {
  id: string;
  eventType: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  payload: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditLogPageDto {
  items: AuditLogEntryDto[];
  total: number;
}

/** Above this many matching rows, GET /audit-log/export refuses and asks the caller to narrow filters. */
export const AUDIT_LOG_EXPORT_MAX_ROWS = 10_000;
