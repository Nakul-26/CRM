# ADR 0007: Subscriptions Phase 7 scope — no payment processing, lazy lapse + a job-table scheduler, and a permission-narrowing continuation

## Status

Accepted — 2026-08-17

## Context

The three `ComingSoon` stubs at `apps/web/src/app/(dashboard)/subscriptions/
{,plans,renewals}/page.tsx` are labeled `phase="Phase 7 (Subscriptions)"`,
confirming this is Phase 7. `packages/contracts/src/permissions.ts` already
reserved `subscriptions.view`, `subscriptions.create`, `subscriptions.manage`
since Phase 1 — a flat single-namespace shape, unlike Support's
three-namespace split (`support.tickets.*`/`support.sla_policies.*`/
`support.kb.*`). This phase honors that shape rather than fragmenting it.
[ADR 0001](0001-modular-monolith.md) is the only place with a concrete
technical hint about *how* Renewals should work: "a Postgres-backed job
table covers renewal reminders etc." — the reasoning that keeps Temporal
deferred. Nothing else about Subscriptions was scoped anywhere: no billing/
payment env vars, no Stripe references, no `notifications` module (that
name is reserved in ADR 0001's module list but has zero implementation).

## Decisions

**1. One module, three sub-resources, folder-per-subdomain, mapping 1:1 onto the three frontend routes.**
`apps/api/src/modules/subscriptions/{plans,subscriptions,renewals}/`, one
`pgSchema("subscriptions")` holding `plans`, `subscriptions`,
`renewal_reminders`. Mirrors Support's shape (three real sub-resources
sharing one module). `renewals/` holds the reminder-log access and
scheduler, not a fourth CRUD resource.

**2. No payment/billing integration this phase.**
Renewal is a manual action (`POST /subscriptions/:id/renew`) that extends
the current period — no charge processor, no Stripe, no webhook handling.
Zero payment infrastructure exists anywhere in the codebase (no env vars,
no docker-compose service, no package) — the same "defer until a concrete
need forces it" discipline ADR 0001 already applies to RabbitMQ/Keycloak/
Temporal/OpenSearch. A production deployment of this phase is an internal
subscription-lifecycle tracker, not a billing system.

**3. No trial period.**
Subscription status is `active | lapsed | cancelled` — no `trialing`.
Plans carry no `trialDays` field. A `trialing` status with no trial-length
field or trial-end automation behind it would be state with no real
behavior — the same discipline that kept Phase 6's SLA breach purely
computed rather than half-modeled. Trials are a coherent future feature
(field + status + automation together), not an easy partial add now.

**4. Subscription status is a fixed 3-state graph, not a generic transition map.**
`active → cancelled` (explicit `POST /subscriptions/:id/cancel`),
`active → lapsed` (lazy, read-time — see decision 6), `lapsed → active`
(explicit `POST /subscriptions/:id/renew`, extends the period),
`lapsed → cancelled` (explicit), `cancelled → []` (terminal, like quotes'
`accepted`). Two explicit actions, each with one precondition check, sit
closer to Quotes' inline-checked `send`/`accept`/`reject` methods
(`if (status !== "sent") throw ConflictException`) than to Leads/Tickets'
generic `ALLOWED_TRANSITIONS` map, which exists to handle branchier graphs
than this one has.

**5. Plan fields snapshot onto the subscription at creation; `renew` never re-reads the live plan.**
`subscriptions.planName`/`price`/`billingInterval` are copied from the
plan once, at creation (`SubscriptionsService.create()`). `renew()`
extends `currentPeriodEnd` using the subscription's own *snapshotted*
`billingInterval`, not whatever the plan's current interval is. Same
"snapshot, not live reference" reasoning as quote line items (ADR 0005)
and ticket SLA due-dates (ADR 0006) — editing a plan's price later never
silently changes an existing subscription's rate. Verified live during
manual testing: editing a plan's price after a subscription exists leaves
the subscription's snapshotted price untouched.

**6. No plan upgrade/downgrade path.**
A subscription is created against one plan and stays on that snapshot for
its life; changing plans mid-subscription isn't built this phase. A real
"change plan" flow needs proration rules that don't exist without payment
processing (decision 2) — a separable increment, recorded as a scope cut
here rather than a silent gap.

**7. Lapse is lazy and read-time (reusing Quotes' pattern); the reminder *email* is not, because it has a side effect Quotes' expiry never needed.**
`SubscriptionsService.lapseIfDue()` — checked on every `list`/`findById`,
persisting `status: "lapsed"` and publishing `subscription.lapsed` the
first time an `active` subscription is read past its `currentPeriodEnd` —
is the same "touch-on-access" pattern as `QuotesService.expireIfDue()`,
extracted into a pure, unit-tested predicate (`subscription-lapse.ts`'s
`isLapseDue()`) the same way Phase 6 pulled `computeTicketSlaFlags()` out
of `TicketsService`. But a renewal reminder must proactively email the
customer *even if nobody opens the subscriptions page that day* — a
requirement neither lazy-lapse nor Phase 6's purely-computed SLA breach
flag has, because neither of those needs an out-of-band side effect to
fire on a schedule. That's decision 8's actual justification, not just a
default choice.

**8. Renewal reminders: a Postgres job table (`renewal_reminders`) polled by `@nestjs/schedule`, not Redis/BullMQ/Temporal.**
One row per (subscription, period) with `remindAt`/`sentAt`. A
`@Cron("*/15 * * * *")` provider (`RenewalsScheduler`) calls
`RenewalsService.processDueReminders()`, which queries
`remindAt <= now() AND sentAt IS NULL` — confirming ADR 0001's own
deferred-tech row instead of contradicting it. Redis has been provisioned
in `docker-compose.yml` since Phase 1 but is unused anywhere in the
codebase; there was no cron/scheduler precedent to build on before this
phase. `processDueReminders()` is kept directly callable so tests (and, if
ever needed, an ops runbook) don't have to wait on the clock — e2e tests
call it immediately after backdating a reminder row's `remindAt`, the same
"reach into the DB to set up time-dependent state" technique Phase 6's
ticket-breach tests already used. This is the first scheduled/background
process in the codebase; `@nestjs/schedule` is a new dependency, flagged
here explicitly the same way nodemailer was flagged as new in ADR 0006.
The reminder lead time is a hardcoded `RENEWAL_REMINDER_LEAD_DAYS = 7`
constant, not per-org configurable this phase.

**9. Reminder emails route through the existing `MailListener`, not a direct `MailerService` call from the scheduler.**
`RenewalsService` enriches its own event payload (looks up the
subscription's account/contact, the same "publishing services enrich
their own payload" rule `TicketsService`/`QuotesService` already follow)
and publishes `subscription.renewal_reminder_sent` with an **explicit**
`organizationId` — there is no request context on a scheduler tick, and
`DomainEventBus.publish()` already accepts one, falling back to request
context only when omitted (confirmed by reading `shared/events/
domain-event-bus.ts`; no changes needed there). A fourth `MailListener`
handler (`onSubscriptionRenewalReminderSent`) sends the mail. The
scheduler marks the reminder row's `sentAt` immediately after publishing
— fire-and-forget, not after confirming delivery — the same best-effort
posture `AuditListener`/`MailListener` already use everywhere ("log and
move on, never block the operation that triggered it"); here "the
operation" is the scheduler tick itself rather than a user request. This
keeps ADR 0006 decision #7's "zero service dependencies beyond
`MailerService`" shape intact with no scheduler-specific exception.

**10. `subscriptions.manage` narrows to Plan mutations only, continuing Phase 6's permission-narrowing move.**
The reserved permission set is extended to `subscriptions.view/create/
edit/delete/manage` — adding `.edit`/`.delete` so Subscriptions gets the
same `view/create/edit/delete` shape as every other domain.
`subscriptions.manage`, reserved since Phase 1 with no defined meaning
beyond "not view/create," now specifically gates `/plans` POST/PATCH/
DELETE. `subscriptions.view` covers viewing Plans, Subscriptions, and
Renewals alike — one namespace, not three, matching how the permission was
originally reserved. This is a direct continuation of ADR 0006 decision
#5's move (`support.tickets.manage` narrowed to reassignment once `.edit`
existed) — the same "an already-reserved coarse permission narrows to
something specific once granular ones exist" pattern, applied to a
permission set that was reserved with a single-namespace shape from the
start rather than Support's three-namespace one. The Member role gains
`subscriptions.create`/`subscriptions.edit` (it previously had only
`.view`) so a Member can actually create/cancel/renew subscriptions for
their accounts, matching every other domain's Member split (day-to-day
lifecycle work, not deletion or the admin-configured resource).

**11. Renewal history isn't surfaced as its own endpoint this phase.**
`SubscriptionDto` gets one computed field, `currentPeriodReminderSent:
boolean`, populated by checking whether the most recently created
`renewal_reminders` row for that subscription has `sentAt` set — enough
for the Renewals page to show reminder status without a dedicated
`GET /subscriptions/:id/renewal-reminders` endpoint. A full reminder audit
log is a cheap, separable follow-up if ever needed — recorded here as a
deferral, not a silent gap.

**12. Fifth real use of the `TIMELINE_EVENT_TYPES` extension point.**
`subscription.created`, `subscription.cancelled`, `subscription.renewed`,
`subscription.lapsed` (all carrying `accountId`) were added, after
`lead.converted`, Phase 4's `opportunity.*`, Phase 5's `quote.*`, and Phase
6's `ticket.*`. `subscription.renewal_reminder_sent` is deliberately left
off the timeline — it's an operational detail (a notification fired), not
a customer-facing milestone, the same selectivity that left
`ticket.assigned` off the timeline in Phase 6.

## Consequences

- A subscription created today is locked to the plan's price/interval at
  that moment; a later plan price change never retroactively changes it,
  and there is no built-in path to move an existing subscription onto a
  different plan or its plan's current price.
- This phase ships no payment processing at all — "creating a
  subscription" and "renewing" are internal record-keeping actions, not
  billing events. A production deployment wanting real billing needs a
  distinct, separately-scoped integration.
- A subscription's lapse status can only be discovered by reading it (list
  or findById) — same trade-off Quotes' lazy expiry already accepted, and
  for the same reason (no scheduler existed for that need, and lapse
  itself has no proactive side effect requiring one).
- Renewal reminders, unlike lapse, do have a real scheduled component now
  — the first one in the codebase. Any future "notify X when Y happens on
  a schedule" need should evaluate reusing `renewal_reminders`' shape
  (a small job table + a `@Cron` poller) before reaching for new
  infrastructure.
- `SMTP_FROM`/`WEB_APP_URL` (added in Phase 6) and the mail infrastructure
  are reused as-is; no new environment variables were needed this phase.
