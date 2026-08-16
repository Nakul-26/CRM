"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicQuoteViewDto } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function usePublicQuote(token: string | undefined) {
  return useQuery<PublicQuoteViewDto>({
    queryKey: ["public-quote", token],
    queryFn: () => apiFetch<PublicQuoteViewDto>(`public/quotes/${token}`),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useAcceptPublicQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => apiFetch<PublicQuoteViewDto>(`public/quotes/${token}/accept`, { method: "POST" }),
    onSuccess: (_data, token) => queryClient.invalidateQueries({ queryKey: ["public-quote", token] }),
  });
}

export function useRejectPublicQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => apiFetch<PublicQuoteViewDto>(`public/quotes/${token}/reject`, { method: "POST" }),
    onSuccess: (_data, token) => queryClient.invalidateQueries({ queryKey: ["public-quote", token] }),
  });
}
