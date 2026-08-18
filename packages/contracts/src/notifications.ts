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
