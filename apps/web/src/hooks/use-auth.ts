"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuthenticatedUser,
  LoginInput,
  RegisterOrganizationInput,
} from "@sales-platform/contracts";
import { ApiError } from "@/lib/http";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data, res.status);
  return data as T;
}

export function useCurrentUser() {
  return useQuery<AuthenticatedUser>({
    queryKey: ["current-user"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) throw new Error("Not authenticated");
      return res.json();
    },
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => postJson<{ user: AuthenticatedUser }>("/api/auth/login", input),
    onSuccess: (data) => queryClient.setQueryData(["current-user"], data.user),
  });
}

export function useRegisterOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterOrganizationInput) =>
      postJson<{ user: AuthenticatedUser }>("/api/auth/register", input),
    onSuccess: (data) => queryClient.setQueryData(["current-user"], data.user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetch("/api/auth/logout", { method: "POST" }),
    onSuccess: () => queryClient.setQueryData(["current-user"], null),
  });
}
