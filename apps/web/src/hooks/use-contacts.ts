"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContactDto, CreateContactInput, UpdateContactInput } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function useContacts(accountId?: string) {
  return useQuery<ContactDto[]>({
    queryKey: ["contacts", accountId ?? "all"],
    queryFn: () => apiFetch<ContactDto[]>(accountId ? `contacts?accountId=${accountId}` : "contacts"),
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContactInput) => apiFetch<ContactDto>("contacts", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["contacts"] }),
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateContactInput }) =>
      apiFetch<ContactDto>(`contacts/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["contacts"] }),
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["contacts"] }),
  });
}
