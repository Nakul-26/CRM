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

export const LEAD_EVENT_TYPES = [
  "lead.created",
  "lead.updated",
  "lead.status_changed",
  "lead.converted",
  "lead.deleted",
  "lead.scoring_rule_created",
  "lead.scoring_rule_updated",
  "lead.scoring_rule_deleted",
] as const;

export type LeadEventType = (typeof LEAD_EVENT_TYPES)[number];

export const SALES_EVENT_TYPES = [
  "opportunity.created",
  "opportunity.updated",
  "opportunity.stage_changed",
  "opportunity.won",
  "opportunity.lost",
  "opportunity.deleted",
  "pipeline.created",
  "pipeline.updated",
  "pipeline.deleted",
  "stage.created",
  "stage.updated",
  "stage.deleted",
] as const;

export type SalesEventType = (typeof SALES_EVENT_TYPES)[number];

export const PRODUCTS_EVENT_TYPES = [
  "product.created",
  "product.updated",
  "product.deleted",
] as const;

export type ProductsEventType = (typeof PRODUCTS_EVENT_TYPES)[number];

export const QUOTES_EVENT_TYPES = [
  "quote.created",
  "quote.updated",
  "quote.sent",
  "quote.accepted",
  "quote.rejected",
  "quote.expired",
  "quote.revised",
  "quote.deleted",
  "quote_template.created",
  "quote_template.updated",
  "quote_template.deleted",
] as const;

export type QuotesEventType = (typeof QUOTES_EVENT_TYPES)[number];

/**
 * Subset of CRM_EVENT_TYPES/LEAD_EVENT_TYPES/SALES_EVENT_TYPES/QUOTES_EVENT_TYPES
 * that belongs on a customer-facing account timeline (see TimelineService).
 * Later phases append their own "worthy" event types here to slot into the
 * timeline without touching the merge query itself. `lead.converted` was the
 * first of those, the four `opportunity.*` types the second, and the four
 * `quote.*` types below the third — proving the same extension point works
 * for a third, unrelated module (including one whose events can originate
 * from an unauthenticated request — see PublicQuotesController).
 */
export const TIMELINE_EVENT_TYPES = [
  "account.created",
  "account.updated",
  "account.deleted",
  "contact.created",
  "contact.updated",
  "contact.deleted",
  "lead.converted",
  "opportunity.created",
  "opportunity.stage_changed",
  "opportunity.won",
  "opportunity.lost",
  "quote.created",
  "quote.sent",
  "quote.accepted",
  "quote.rejected",
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];
