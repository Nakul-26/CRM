"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActivityDto, CreateActivityInput, UpdateActivityInput } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export interface ActivityFilters {
  accountId?: string;
  contactId?: string;
  type?: string;
}

export function useActivities(filters: ActivityFilters = {}) {
  const params = new URLSearchParams();
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.contactId) params.set("contactId", filters.contactId);
  if (filters.type) params.set("type", filters.type);
  const qs = params.toString();

  return useQuery<ActivityDto[]>({
    queryKey: ["activities", filters.accountId ?? "-", filters.contactId ?? "-", filters.type ?? "-"],
    queryFn: () => apiFetch<ActivityDto[]>(`activities${qs ? `?${qs}` : ""}`),
  });
}

export function useCreateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateActivityInput) => apiFetch<ActivityDto>("activities", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
}

export function useUpdateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateActivityInput }) =>
      apiFetch<ActivityDto>(`activities/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
}

export function useDeleteActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`activities/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
}
