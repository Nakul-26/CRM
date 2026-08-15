"use client";

import { useQuery } from "@tanstack/react-query";
import type { SearchResultDto } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function useSearch(query: string) {
  const q = query.trim();
  return useQuery<SearchResultDto[]>({
    queryKey: ["search", q],
    queryFn: () => apiFetch<SearchResultDto[]>(`search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
  });
}
