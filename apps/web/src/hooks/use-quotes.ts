"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateQuoteInput,
  CreateTemplateInput,
  QuoteDto,
  QuoteStatus,
  QuoteTemplateDto,
  QuoteVersionDto,
  UpdateQuoteInput,
  UpdateTemplateInput,
} from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export interface QuoteDetail {
  quote: QuoteDto;
  version: QuoteVersionDto;
}

export interface QuoteFilters {
  status?: QuoteStatus;
  accountId?: string;
  opportunityId?: string;
}

function toQuery(filters: QuoteFilters) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.opportunityId) params.set("opportunityId", filters.opportunityId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useQuotes(filters: QuoteFilters = {}) {
  return useQuery<QuoteDto[]>({
    queryKey: ["quotes", filters],
    queryFn: () => apiFetch<QuoteDto[]>(`quotes${toQuery(filters)}`),
  });
}

export function useQuote(id: string | undefined) {
  return useQuery<QuoteDetail>({
    queryKey: ["quotes", id],
    queryFn: () => apiFetch<QuoteDetail>(`quotes/${id}`),
    enabled: Boolean(id),
  });
}

export function useQuoteVersions(id: string | undefined) {
  return useQuery<QuoteVersionDto[]>({
    queryKey: ["quotes", id, "versions"],
    queryFn: () => apiFetch<QuoteVersionDto[]>(`quotes/${id}/versions`),
    enabled: Boolean(id),
  });
}

export function useQuoteTemplates() {
  return useQuery<QuoteTemplateDto[]>({
    queryKey: ["quote-templates"],
    queryFn: () => apiFetch<QuoteTemplateDto[]>("quotes/templates"),
  });
}

function invalidateQuote(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  queryClient.invalidateQueries({ queryKey: ["quotes"] });
  queryClient.invalidateQueries({ queryKey: ["quotes", id] });
}

export function useCreateQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateQuoteInput) => apiFetch<QuoteDetail>("quotes", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quotes"] }),
  });
}

export function useUpdateQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateQuoteInput }) =>
      apiFetch<QuoteDetail>(`quotes/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => invalidateQuote(queryClient, variables.id),
  });
}

export function useDeleteQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`quotes/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quotes"] }),
  });
}

export function useSendQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<QuoteDetail>(`quotes/${id}/send`, { method: "POST" }),
    onSuccess: (_data, id) => invalidateQuote(queryClient, id),
  });
}

export function useReviseQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<QuoteDetail>(`quotes/${id}/revise`, { method: "POST" }),
    onSuccess: (_data, id) => {
      invalidateQuote(queryClient, id);
      queryClient.invalidateQueries({ queryKey: ["quotes", id, "versions"] });
    },
  });
}

export function useCreateQuoteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTemplateInput) =>
      apiFetch<QuoteTemplateDto>("quotes/templates", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quote-templates"] }),
  });
}

export function useUpdateQuoteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTemplateInput }) =>
      apiFetch<QuoteTemplateDto>(`quotes/templates/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quote-templates"] }),
  });
}

export function useDeleteQuoteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`quotes/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quote-templates"] }),
  });
}
