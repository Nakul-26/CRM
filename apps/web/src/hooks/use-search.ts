"use client";

import { useQuery } from "@tanstack/react-query";
import type { SearchResultDto } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

/**
 * `types` defaults to the server's own default (`account` + `contact`,
 * see SearchController) when omitted — pass it explicitly (e.g. to add
 * `"lead"`) once the caller has confirmed the viewer can see that type.
 * See docs/decisions/0020-lead-search-frontend-phase20-scope.md.
 */
export function useSearch(query: string, types?: ("account" | "contact" | "lead")[]) {
  const q = query.trim();
  const typesKey = types?.join(",");
  return useQuery<SearchResultDto[]>({
    queryKey: ["search", q, typesKey],
    queryFn: () => apiFetch<SearchResultDto[]>(`search?q=${encodeURIComponent(q)}${typesKey ? `&types=${typesKey}` : ""}`),
    enabled: q.length > 0,
  });
}
