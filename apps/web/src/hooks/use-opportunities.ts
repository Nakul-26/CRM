"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateOpportunityInput,
  MoveOpportunityStageInput,
  OpportunityDto,
  OpportunityForecastPointDto,
  OpportunityStageHistoryEntryDto,
  OpportunitySummaryStatsDto,
  UpdateOpportunityInput,
} from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export interface OpportunityFilters {
  pipelineId?: string;
  stageId?: string;
  ownerId?: string;
  outcome?: string;
}

function toQuery(filters: OpportunityFilters) {
  const params = new URLSearchParams();
  if (filters.pipelineId) params.set("pipelineId", filters.pipelineId);
  if (filters.stageId) params.set("stageId", filters.stageId);
  if (filters.ownerId) params.set("ownerId", filters.ownerId);
  if (filters.outcome) params.set("outcome", filters.outcome);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useOpportunities(filters: OpportunityFilters = {}) {
  return useQuery<OpportunityDto[]>({
    queryKey: ["opportunities", filters],
    queryFn: () => apiFetch<OpportunityDto[]>(`opportunities${toQuery(filters)}`),
  });
}

export function useOpportunity(id: string | undefined) {
  return useQuery<OpportunityDto>({
    queryKey: ["opportunities", id],
    queryFn: () => apiFetch<OpportunityDto>(`opportunities/${id}`),
    enabled: Boolean(id),
  });
}

export function useOpportunityStats() {
  return useQuery<OpportunitySummaryStatsDto>({
    queryKey: ["opportunities", "stats", "summary"],
    queryFn: () => apiFetch<OpportunitySummaryStatsDto>("opportunities/stats/summary"),
  });
}

export function useOpportunityForecast() {
  return useQuery<OpportunityForecastPointDto[]>({
    queryKey: ["opportunities", "stats", "forecast"],
    queryFn: () => apiFetch<OpportunityForecastPointDto[]>("opportunities/stats/forecast"),
  });
}

export function useOpportunityStageHistory(id: string | undefined) {
  return useQuery<OpportunityStageHistoryEntryDto[]>({
    queryKey: ["opportunities", id, "stage-history"],
    queryFn: () => apiFetch<OpportunityStageHistoryEntryDto[]>(`opportunities/${id}/stage-history`),
    enabled: Boolean(id),
  });
}

function invalidateOpportunity(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  queryClient.invalidateQueries({ queryKey: ["opportunities"] });
  queryClient.invalidateQueries({ queryKey: ["opportunities", id] });
}

export function useCreateOpportunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOpportunityInput) =>
      apiFetch<OpportunityDto>("opportunities", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["opportunities"] }),
  });
}

export function useUpdateOpportunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateOpportunityInput }) =>
      apiFetch<OpportunityDto>(`opportunities/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => invalidateOpportunity(queryClient, variables.id),
  });
}

export function useDeleteOpportunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`opportunities/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["opportunities"] }),
  });
}

export function useMoveOpportunityStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MoveOpportunityStageInput }) =>
      apiFetch<OpportunityDto>(`opportunities/${id}/stage`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => {
      invalidateOpportunity(queryClient, variables.id);
      queryClient.invalidateQueries({ queryKey: ["opportunities", "stats"] });
    },
  });
}
