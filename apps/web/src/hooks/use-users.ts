"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InviteUserInput, UserDto } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function useUsers() {
  return useQuery<UserDto[]>({
    queryKey: ["users"],
    queryFn: () => apiFetch<UserDto[]>("users"),
  });
}

export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteUserInput) =>
      apiFetch<{ user: UserDto; temporaryPassword: string }>("users/invite", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useDeactivateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => apiFetch(`users/${userId}/deactivate`, { method: "PATCH" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}
