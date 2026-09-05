"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationPreferencesDto, UpdateNotificationPreferencesInput } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

/**
 * See docs/decisions/0019-notification-preferences-phase19-scope.md — same
 * `apiFetch`/query-key shape as use-notifications.ts.
 */
export function useNotificationPreferences() {
  return useQuery<NotificationPreferencesDto>({
    queryKey: ["notifications", "preferences"],
    queryFn: () => apiFetch<NotificationPreferencesDto>("notifications/preferences"),
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateNotificationPreferencesInput) =>
      apiFetch<NotificationPreferencesDto>("notifications/preferences", { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", "preferences"] }),
  });
}
