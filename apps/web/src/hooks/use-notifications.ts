"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationDto, UnreadCountDto } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

function invalidateNotifications(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
}

export function useNotifications() {
  return useQuery<NotificationDto[]>({
    queryKey: ["notifications", "list"],
    queryFn: () => apiFetch<NotificationDto[]>("notifications"),
  });
}

/** Polled — the app has no WebSocket/SSE infra (see docs/decisions/0009-notifications-phase9-scope.md). */
export function useUnreadCount() {
  return useQuery<UnreadCountDto>({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => apiFetch<UnreadCountDto>("notifications/unread-count"),
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () => invalidateNotifications(queryClient),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>("notifications/read-all", { method: "POST" }),
    onSuccess: () => invalidateNotifications(queryClient),
  });
}
