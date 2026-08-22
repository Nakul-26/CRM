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

export const SUPPORT_EVENT_TYPES = [
  "ticket.created",
  "ticket.updated",
  "ticket.status_changed",
  "ticket.assigned",
  "ticket.comment_added",
  "ticket.deleted",
  "sla_policy.created",
  "sla_policy.updated",
  "sla_policy.deleted",
  "kb_article.created",
  "kb_article.updated",
  "kb_article.published",
  "kb_article.deleted",
] as const;

export type SupportEventType = (typeof SUPPORT_EVENT_TYPES)[number];

export const SUBSCRIPTIONS_EVENT_TYPES = [
  "plan.created",
  "plan.updated",
  "plan.deleted",
  "subscription.created",
  "subscription.updated",
  "subscription.cancelled",
  "subscription.renewed",
  "subscription.lapsed",
  "subscription.deleted",
  "subscription.renewal_reminder_sent",
] as const;

export type SubscriptionsEventType = (typeof SUBSCRIPTIONS_EVENT_TYPES)[number];

export const PAYMENTS_EVENT_TYPES = [
  "payment.checkout_started",
  "payment.succeeded",
  "payment.failed",
] as const;

export type PaymentsEventType = (typeof PAYMENTS_EVENT_TYPES)[number];

/**
 * Subset of CRM_EVENT_TYPES/LEAD_EVENT_TYPES/SALES_EVENT_TYPES/QUOTES_EVENT_TYPES/
 * SUPPORT_EVENT_TYPES/SUBSCRIPTIONS_EVENT_TYPES/PAYMENTS_EVENT_TYPES that belongs
 * on a customer-facing account timeline (see TimelineService). Later phases
 * append their own "worthy" event types here to slot into the timeline
 * without touching the merge query itself. `lead.converted` was the first of
 * those, the four `opportunity.*` types the second, the four `quote.*` types
 * the third, the three `ticket.*` types the fourth, the four `subscription.*`
 * types the fifth, and `payment.succeeded` the sixth — proving the same
 * extension point works for a sixth, unrelated module.
 * `subscription.renewal_reminder_sent` and `payment.checkout_started`/
 * `payment.failed` are deliberately left off: operational details (a
 * notification fired, a checkout merely started), not customer-facing
 * milestones — the same selectivity `ticket.assigned` was left off for.
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
  "ticket.created",
  "ticket.status_changed",
  "ticket.comment_added",
  "subscription.created",
  "subscription.cancelled",
  "subscription.renewed",
  "subscription.lapsed",
  "payment.succeeded",
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];
