"use client";

import { useQuery } from "@tanstack/react-query";
import type { DashboardStatsDto } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function useDashboardStats(enabled = true) {
  return useQuery<DashboardStatsDto>({
    queryKey: ["analytics", "dashboard"],
    queryFn: () => apiFetch<DashboardStatsDto>("analytics/dashboard"),
    enabled,
  });
}
