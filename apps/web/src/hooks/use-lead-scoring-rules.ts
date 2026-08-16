"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateScoringRuleInput, LeadScoringRuleDto, UpdateScoringRuleInput } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function useScoringRules() {
  return useQuery<LeadScoringRuleDto[]>({
    queryKey: ["lead-scoring-rules"],
    queryFn: () => apiFetch<LeadScoringRuleDto[]>("leads/scoring-rules"),
  });
}

export function useCreateScoringRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScoringRuleInput) =>
      apiFetch<LeadScoringRuleDto>("leads/scoring-rules", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lead-scoring-rules"] }),
  });
}

export function useUpdateScoringRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateScoringRuleInput }) =>
      apiFetch<LeadScoringRuleDto>(`leads/scoring-rules/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lead-scoring-rules"] }),
  });
}

export function useDeleteScoringRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`leads/scoring-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lead-scoring-rules"] }),
  });
}
