"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssignTicketInput,
  CreateTicketCommentInput,
  CreateTicketInput,
  TicketCommentDto,
  TicketDto,
  TicketStatus,
  UpdateTicketInput,
} from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export interface TicketFilters {
  status?: TicketStatus;
  priority?: string;
  assigneeId?: string;
}

function toQuery(filters: TicketFilters) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.assigneeId) params.set("assigneeId", filters.assigneeId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useTickets(filters: TicketFilters = {}) {
  return useQuery<TicketDto[]>({
    queryKey: ["tickets", filters],
    queryFn: () => apiFetch<TicketDto[]>(`tickets${toQuery(filters)}`),
  });
}

export function useTicket(id: string | undefined) {
  return useQuery<TicketDto>({
    queryKey: ["tickets", id],
    queryFn: () => apiFetch<TicketDto>(`tickets/${id}`),
    enabled: Boolean(id),
  });
}

export function useTicketComments(id: string | undefined) {
  return useQuery<TicketCommentDto[]>({
    queryKey: ["tickets", id, "comments"],
    queryFn: () => apiFetch<TicketCommentDto[]>(`tickets/${id}/comments`),
    enabled: Boolean(id),
  });
}

function invalidateTicket(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  queryClient.invalidateQueries({ queryKey: ["tickets"] });
  queryClient.invalidateQueries({ queryKey: ["tickets", id] });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput) => apiFetch<TicketDto>("tickets", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useUpdateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTicketInput }) =>
      apiFetch<TicketDto>(`tickets/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => invalidateTicket(queryClient, variables.id),
  });
}

export function useUpdateTicketStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TicketStatus }) =>
      apiFetch<TicketDto>(`tickets/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: (_data, variables) => invalidateTicket(queryClient, variables.id),
  });
}

export function useAssignTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AssignTicketInput }) =>
      apiFetch<TicketDto>(`tickets/${id}/assign`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => invalidateTicket(queryClient, variables.id),
  });
}

export function useAddTicketComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateTicketCommentInput }) =>
      apiFetch<TicketCommentDto>(`tickets/${id}/comments`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => {
      invalidateTicket(queryClient, variables.id);
      queryClient.invalidateQueries({ queryKey: ["tickets", variables.id, "comments"] });
    },
  });
}

export function useDeleteTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`tickets/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tickets"] }),
  });
}
