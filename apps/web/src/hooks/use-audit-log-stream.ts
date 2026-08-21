"use client";

import { useEffect, useState } from "react";

export interface AuditLogStreamFilters {
  eventType?: string;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
}

function toQuery(filters: AuditLogStreamFilters) {
  const params = new URLSearchParams();
  if (filters.eventType) params.set("eventType", filters.eventType);
  if (filters.actorId) params.set("actorId", filters.actorId);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  return params.toString();
}

/**
 * Live "new audit rows" signal via SSE — only meaningful when `enabled`
 * (the page passes `offset === 0`, the only page a pushed row could belong
 * on). No payload beyond the signal itself; the caller refetches its
 * existing list query on demand. See
 * docs/decisions/0012-audit-log-streaming-phase12-scope.md.
 */
export function useAuditLogStream(filters: AuditLogStreamFilters, enabled: boolean) {
  const [hasNew, setHasNew] = useState(false);
  const query = toQuery(filters);

  useEffect(() => {
    setHasNew(false);
    if (!enabled) return;

    const source = new EventSource(`/api/gateway/audit-log/stream?${query}`);
    source.addEventListener("entry", () => setHasNew(true));

    return () => source.close();
  }, [enabled, query]);

  return { hasNew, dismiss: () => setHasNew(false) };
}
