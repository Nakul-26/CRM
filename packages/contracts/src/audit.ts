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
