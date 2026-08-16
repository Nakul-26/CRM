"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreatePipelineInput,
  CreateStageInput,
  PipelineDto,
  StageDto,
  UpdatePipelineInput,
  UpdateStageInput,
} from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function usePipelines() {
  return useQuery<PipelineDto[]>({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<PipelineDto[]>("pipelines"),
  });
}

export function usePipelineStages(pipelineId: string | undefined) {
  return useQuery<StageDto[]>({
    queryKey: ["pipelines", pipelineId, "stages"],
    queryFn: () => apiFetch<StageDto[]>(`pipelines/${pipelineId}/stages`),
    enabled: Boolean(pipelineId),
  });
}

function invalidatePipelines(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["pipelines"] });
}

export function useCreatePipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePipelineInput) => apiFetch<PipelineDto>("pipelines", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => invalidatePipelines(queryClient),
  });
}

export function useUpdatePipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePipelineInput }) =>
      apiFetch<PipelineDto>(`pipelines/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => invalidatePipelines(queryClient),
  });
}

export function useDeletePipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`pipelines/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidatePipelines(queryClient),
  });
}

export function useCreateStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, input }: { pipelineId: string; input: CreateStageInput }) =>
      apiFetch<StageDto>(`pipelines/${pipelineId}/stages`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["pipelines", variables.pipelineId, "stages"] }),
  });
}

export function useUpdateStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, stageId, input }: { pipelineId: string; stageId: string; input: UpdateStageInput }) =>
      apiFetch<StageDto>(`pipelines/${pipelineId}/stages/${stageId}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["pipelines", variables.pipelineId, "stages"] }),
  });
}

export function useDeleteStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, stageId }: { pipelineId: string; stageId: string }) =>
      apiFetch<void>(`pipelines/${pipelineId}/stages/${stageId}`, { method: "DELETE" }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["pipelines", variables.pipelineId, "stages"] }),
  });
}
