"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateKbArticleInput, KbArticleDto, UpdateKbArticleInput } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export interface KbFilters {
  isPublished?: boolean;
  category?: string;
}

function toQuery(filters: KbFilters) {
  const params = new URLSearchParams();
  if (filters.isPublished !== undefined) params.set("isPublished", String(filters.isPublished));
  if (filters.category) params.set("category", filters.category);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useKbArticles(filters: KbFilters = {}) {
  return useQuery<KbArticleDto[]>({
    queryKey: ["kb-articles", filters],
    queryFn: () => apiFetch<KbArticleDto[]>(`kb${toQuery(filters)}`),
  });
}

export function useKbArticle(id: string | undefined) {
  return useQuery<KbArticleDto>({
    queryKey: ["kb-articles", id],
    queryFn: () => apiFetch<KbArticleDto>(`kb/${id}`),
    enabled: Boolean(id),
  });
}

function invalidateArticle(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  queryClient.invalidateQueries({ queryKey: ["kb-articles"] });
  queryClient.invalidateQueries({ queryKey: ["kb-articles", id] });
}

export function useCreateKbArticle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateKbArticleInput) => apiFetch<KbArticleDto>("kb", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kb-articles"] }),
  });
}

export function useUpdateKbArticle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateKbArticleInput }) =>
      apiFetch<KbArticleDto>(`kb/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => invalidateArticle(queryClient, variables.id),
  });
}

export function useDeleteKbArticle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`kb/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kb-articles"] }),
  });
}

export function usePublishKbArticle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<KbArticleDto>(`kb/${id}/publish`, { method: "POST" }),
    onSuccess: (_data, id) => invalidateArticle(queryClient, id),
  });
}

export function useUnpublishKbArticle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<KbArticleDto>(`kb/${id}/unpublish`, { method: "POST" }),
    onSuccess: (_data, id) => invalidateArticle(queryClient, id),
  });
}
