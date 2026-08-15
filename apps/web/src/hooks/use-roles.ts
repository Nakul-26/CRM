"use client";

import { useQuery } from "@tanstack/react-query";
import type { RoleDto } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function useRoles() {
  return useQuery<RoleDto[]>({
    queryKey: ["roles"],
    queryFn: () => apiFetch<RoleDto[]>("roles"),
  });
}
