export const AUDIT_LOG_ENTRY_CREATED_EVENT = "audit.log.entry.created";

export interface AuditStreamEvent {
  organizationId: string;
  eventType: string;
  actorId: string | null;
  createdAt: string;
}

export interface AuditStreamFilters {
  eventType?: string;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function matchesAuditStreamFilters(event: AuditStreamEvent, filters: AuditStreamFilters): boolean {
  if (filters.eventType && event.eventType !== filters.eventType) return false;
  if (filters.actorId && event.actorId !== filters.actorId) return false;

  const createdAt = new Date(event.createdAt).getTime();
  if (filters.dateFrom && createdAt < new Date(filters.dateFrom).getTime()) return false;
  if (filters.dateTo && createdAt > new Date(filters.dateTo).getTime()) return false;

  return true;
}
