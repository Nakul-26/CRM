"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountDto, CreateAccountInput, UpdateAccountInput } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function useAccounts() {
  return useQuery<AccountDto[]>({
    queryKey: ["accounts"],
    queryFn: () => apiFetch<AccountDto[]>("accounts"),
  });
}

export function useAccount(id: string | undefined) {
  return useQuery<AccountDto>({
    queryKey: ["accounts", id],
    queryFn: () => apiFetch<AccountDto>(`accounts/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAccountInput) => apiFetch<AccountDto>("accounts", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAccountInput }) =>
      apiFetch<AccountDto>(`accounts/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts", variables.id] });
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });
}
