"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateSlaPolicyInput, SlaPolicyDto, UpdateSlaPolicyInput } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function useSlaPolicies() {
  return useQuery<SlaPolicyDto[]>({
    queryKey: ["sla-policies"],
    queryFn: () => apiFetch<SlaPolicyDto[]>("sla-policies"),
  });
}

export function useCreateSlaPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSlaPolicyInput) => apiFetch<SlaPolicyDto>("sla-policies", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sla-policies"] }),
  });
}

export function useUpdateSlaPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSlaPolicyInput }) =>
      apiFetch<SlaPolicyDto>(`sla-policies/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sla-policies"] }),
  });
}

export function useDeleteSlaPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`sla-policies/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sla-policies"] }),
  });
}
