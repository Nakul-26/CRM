"use client";

import { useQuery } from "@tanstack/react-query";
import type { AuditLogPageDto } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export interface AuditLogFilters {
  eventType?: string;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

function toQuery(filters: AuditLogFilters) {
  const params = new URLSearchParams();
  if (filters.eventType) params.set("eventType", filters.eventType);
  if (filters.actorId) params.set("actorId", filters.actorId);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  params.set("limit", String(filters.limit));
  params.set("offset", String(filters.offset));
  return `?${params.toString()}`;
}

export function useAuditLog(filters: AuditLogFilters) {
  return useQuery<AuditLogPageDto>({
    queryKey: ["audit-log", filters],
    queryFn: () => apiFetch<AuditLogPageDto>(`audit-log${toQuery(filters)}`),
  });
}
