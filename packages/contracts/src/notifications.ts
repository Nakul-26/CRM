import { z } from "zod";

/**
 * Phase 9 in-app notifications. See
 * docs/decisions/0009-notifications-phase9-scope.md — a bounded set of
 * existing events (ticket assignment, opportunity won/lost, quote
 * accepted/rejected) create a notification for one specific recipient.
 */
export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface UnreadCountDto {
  count: number;
}

/**
 * Phase 19 delivery preferences — one global mode per user, gating only the
 * additional email channel (in-app notifications are unconditional). See
 * docs/decisions/0019-notification-preferences-phase19-scope.md.
 */
export type NotificationEmailDeliveryMode = "off" | "immediate" | "daily_digest";

export interface NotificationPreferencesDto {
  emailDelivery: NotificationEmailDeliveryMode;
}

export const updateNotificationPreferencesSchema = z.object({
  emailDelivery: z.enum(["off", "immediate", "daily_digest"]),
});
export type UpdateNotificationPreferencesInput = z.infer<typeof updateNotificationPreferencesSchema>;
