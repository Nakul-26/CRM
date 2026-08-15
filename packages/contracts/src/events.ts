/**
 * Domain event envelope. Identical shape whether the transport underneath is
 * an in-process EventEmitter (Phase 1) or RabbitMQ (once a module is split
 * into its own service) — see docs/decisions/0001-modular-monolith.md.
 */
export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  eventId: string;
  eventType: TType;
  timestamp: string;
  organizationId: string;
  actorId?: string;
  correlationId: string;
  payload: TPayload;
}

export const IDENTITY_EVENT_TYPES = [
  "organization.created",
  "user.created",
  "user.invited",
  "user.deactivated",
  "user.role_assigned",
  "user.role_revoked",
  "user.login_succeeded",
  "user.login_failed",
  "user.password_changed",
] as const;

export type IdentityEventType = (typeof IDENTITY_EVENT_TYPES)[number];

export const CRM_EVENT_TYPES = [
  "account.created",
  "account.updated",
  "account.deleted",
  "contact.created",
  "contact.updated",
  "contact.deleted",
  "activity.logged",
  "activity.updated",
  "activity.deleted",
] as const;

export type CrmEventType = (typeof CRM_EVENT_TYPES)[number];

/**
 * Subset of CRM_EVENT_TYPES that belongs on a customer-facing account
 * timeline (see TimelineService). Later phases (opportunities, quotes,
 * subscriptions, tickets) append their own "worthy" event types here to
 * slot into the timeline without touching the merge query itself.
 */
export const TIMELINE_EVENT_TYPES = [
  "account.created",
  "account.updated",
  "account.deleted",
  "contact.created",
  "contact.updated",
  "contact.deleted",
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];
