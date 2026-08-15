"use client";

import { useQuery } from "@tanstack/react-query";
import type { TimelineEntryDto } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function useTimeline(accountId: string | undefined, filters: { type?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  const qs = params.toString();

  return useQuery<TimelineEntryDto[]>({
    queryKey: ["timeline", accountId, filters.type ?? "-"],
    queryFn: () => apiFetch<TimelineEntryDto[]>(`accounts/${accountId}/timeline${qs ? `?${qs}` : ""}`),
    enabled: Boolean(accountId),
  });
}
