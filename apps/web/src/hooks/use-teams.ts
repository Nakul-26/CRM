"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateTeamInput, TeamDto } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function useTeams() {
  return useQuery<TeamDto[]>({
    queryKey: ["teams"],
    queryFn: () => apiFetch<TeamDto[]>("teams"),
  });
}

export function useCreateTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTeamInput) =>
      apiFetch<TeamDto>("teams", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams"] }),
  });
}
