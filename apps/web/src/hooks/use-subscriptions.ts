"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateSubscriptionInput, SubscriptionDto, SubscriptionStatus, UpdateSubscriptionInput } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export interface SubscriptionFilters {
  status?: SubscriptionStatus;
  accountId?: string;
}

function toQuery(filters: SubscriptionFilters) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.accountId) params.set("accountId", filters.accountId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useSubscriptions(filters: SubscriptionFilters = {}) {
  return useQuery<SubscriptionDto[]>({
    queryKey: ["subscriptions", filters],
    queryFn: () => apiFetch<SubscriptionDto[]>(`subscriptions${toQuery(filters)}`),
  });
}

export function useSubscription(id: string | undefined) {
  return useQuery<SubscriptionDto>({
    queryKey: ["subscriptions", id],
    queryFn: () => apiFetch<SubscriptionDto>(`subscriptions/${id}`),
    enabled: Boolean(id),
  });
}

function invalidateSubscription(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
  queryClient.invalidateQueries({ queryKey: ["subscriptions", id] });
}

export function useCreateSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSubscriptionInput) => apiFetch<SubscriptionDto>("subscriptions", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
  });
}

export function useUpdateSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSubscriptionInput }) =>
      apiFetch<SubscriptionDto>(`subscriptions/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => invalidateSubscription(queryClient, variables.id),
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<SubscriptionDto>(`subscriptions/${id}/cancel`, { method: "POST" }),
    onSuccess: (_data, id) => invalidateSubscription(queryClient, id),
  });
}

export function useRenewSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<SubscriptionDto>(`subscriptions/${id}/renew`, { method: "POST" }),
    onSuccess: (_data, id) => invalidateSubscription(queryClient, id),
  });
}

export function useDeleteSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`subscriptions/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
  });
}
