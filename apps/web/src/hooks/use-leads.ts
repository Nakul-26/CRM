"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConvertLeadResultDto, CreateLeadInput, LeadDto, LeadSourceStatDto, UpdateLeadInput } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function useLeads(status?: string) {
  return useQuery<LeadDto[]>({
    queryKey: ["leads", { status }],
    queryFn: () => apiFetch<LeadDto[]>(`leads${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  });
}

export function useLead(id: string | undefined) {
  return useQuery<LeadDto>({
    queryKey: ["leads", id],
    queryFn: () => apiFetch<LeadDto>(`leads/${id}`),
    enabled: Boolean(id),
  });
}

export function useLeadSourceStats() {
  return useQuery<LeadSourceStatDto[]>({
    queryKey: ["leads", "stats", "by-source"],
    queryFn: () => apiFetch<LeadSourceStatDto[]>("leads/stats/by-source"),
  });
}

export function useLeadDuplicates(email: string, company: string) {
  const trimmedEmail = email.trim();
  const trimmedCompany = company.trim();
  const params = new URLSearchParams();
  if (trimmedEmail) params.set("email", trimmedEmail);
  if (trimmedCompany) params.set("company", trimmedCompany);

  return useQuery<LeadDto[]>({
    queryKey: ["leads", "duplicates", trimmedEmail, trimmedCompany],
    queryFn: () => apiFetch<LeadDto[]>(`leads/duplicates?${params.toString()}`),
    enabled: Boolean(trimmedEmail || trimmedCompany),
  });
}

function invalidateLead(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  queryClient.invalidateQueries({ queryKey: ["leads"] });
  queryClient.invalidateQueries({ queryKey: ["leads", id] });
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLeadInput) => apiFetch<LeadDto>("leads", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });
}

export function useUpdateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateLeadInput }) =>
      apiFetch<LeadDto>(`leads/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => invalidateLead(queryClient, variables.id),
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`leads/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });
}

export function useMarkLeadContacted() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<LeadDto>(`leads/${id}/contact`, { method: "POST" }),
    onSuccess: (_data, id) => invalidateLead(queryClient, id),
  });
}

export function useQualifyLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: "qualified" | "unqualified" }) =>
      apiFetch<LeadDto>(`leads/${id}/qualify`, { method: "POST", body: JSON.stringify({ outcome }) }),
    onSuccess: (_data, variables) => invalidateLead(queryClient, variables.id),
  });
}

export function useConvertLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<ConvertLeadResultDto>(`leads/${id}/convert`, { method: "POST" }),
    onSuccess: (_data, id) => {
      invalidateLead(queryClient, id);
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

export function useRecalculateLeadScore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<LeadDto>(`leads/${id}/recalculate-score`, { method: "POST" }),
    onSuccess: (_data, id) => invalidateLead(queryClient, id),
  });
}
