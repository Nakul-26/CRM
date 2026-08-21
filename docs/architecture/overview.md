# Architecture Overview

See [ADR 0001](../decisions/0001-modular-monolith.md) for why this is a
modular monolith rather than microservices, and what it takes to split a
module into a real service later. See [ADR 0002](../decisions/0002-crm-phase2-scope.md)
for what Phase 2 (CRM) deliberately left out, and
[docs/plans/0002-phase2-crm-plan.md](../plans/0002-phase2-crm-plan.md) for
the full Phase 2 implementation plan (data model, timeline/search design,
sequencing). See [docs/plans/0003-phase3-leads-plan.md](../plans/0003-phase3-leads-plan.md)
for the Phase 3 (Leads) implementation plan, and
[ADR 0003](../decisions/0003-leads-phase3-scope.md) for what it deliberately
left out (and the one place it deliberately crosses a module boundary). See
[docs/plans/0004-phase4-sales-plan.md](../plans/0004-phase4-sales-plan.md)
for the Phase 4 (Sales Pipeline) implementation plan, and
[ADR 0004](../decisions/0004-sales-phase4-scope.md) for what it deliberately
left out. See [docs/plans/0005-phase5-quotations-plan.md](../plans/0005-phase5-quotations-plan.md)
for the Phase 5 (Quotations) implementation plan, and
[ADR 0005](../decisions/0005-quotations-phase5-scope.md) for what it
deliberately left out. See [docs/plans/0006-phase6-support-plan.md](../plans/0006-phase6-support-plan.md)
for the Phase 6 (Support) implementation plan, and
[ADR 0006](../decisions/0006-support-phase6-scope.md) for what it
deliberately left out. See [docs/plans/0007-phase7-subscriptions-plan.md](../plans/0007-phase7-subscriptions-plan.md)
for the Phase 7 (Subscriptions) implementation plan, and
[ADR 0007](../decisions/0007-subscriptions-phase7-scope.md) for what it
deliberately left out. See [docs/plans/0008-phase8-analytics-automation-plan.md](../plans/0008-phase8-analytics-automation-plan.md)
for the Phase 8 (Analytics & Automation) implementation plan, and
[ADR 0008](../decisions/0008-analytics-automation-phase8-scope.md) for what
it deliberately left out. See [docs/plans/0009-phase9-notifications-plan.md](../plans/0009-phase9-notifications-plan.md)
for the Phase 9 (Notifications) implementation plan, and
[ADR 0009](../decisions/0009-notifications-phase9-scope.md) for what it
deliberately left out. See [docs/plans/0010-phase10-audit-log-plan.md](../plans/0010-phase10-audit-log-plan.md)
for the Phase 10 (Audit Log UI) implementation plan, and
[ADR 0010](../decisions/0010-audit-log-ui-phase10-scope.md) for what it
deliberately left out. See [docs/plans/0011-phase11-csv-export-plan.md](../plans/0011-phase11-csv-export-plan.md)
for the Phase 11 (Audit Log CSV Export) implementation plan, and
[ADR 0011](../decisions/0011-audit-log-csv-export-phase11-scope.md) for what
it deliberately left out. See [docs/plans/0012-phase12-streaming-plan.md](../plans/0012-phase12-streaming-plan.md)
for the Phase 12 (Audit Log Real-Time Streaming) implementation plan, and
[ADR 0012](../decisions/0012-audit-log-streaming-phase12-scope.md) for what
it deliberately left out.

## System shape

```text
apps/web        Next.js app (App Router). Talks only to apps/api.
apps/api        NestJS modular monolith — this IS the API gateway for now.
                One process, one Postgres database, module-per-domain.
packages/*      Code shared between web and api (types, validation, config).
```

```text
apps/api/src/modules/
  identity/       organizations, users, teams, roles, permissions, auth,
                  audit log query (read side of the append-only audit trail)
  crm/            accounts, contacts, activities, timeline, search
  leads/          lead CRUD, scoring rules, qualification, conversion
  sales/          opportunities, pipelines, stages, forecast/analytics,
                  automation (quote-acceptance -> stage auto-advance listener)
  products/       product catalog, volume-based price tiers
  quotes/         quotes, versions, templates, PDF, public acceptance
  support/        tickets, SLA policies, knowledge base
  subscriptions/  plans, subscriptions, renewal reminders (scheduled job)
  analytics/      cross-entity dashboard metrics (reads other modules'
                  schemas directly, owns no schema of its own)
  notifications/  in-app notification center (bell icon, unread state),
                  event-driven off ticket/opportunity/quote outcomes
  shared/         tenant context, event bus, audit listener, guards,
                  mailer/mail listener (email dispatch)
```

Every module follows: `Controller -> Application Service -> Domain Logic ->
Repository -> Database`. No module imports another module's repository or
Drizzle schema directly — cross-module reads go through the other module's
exported service; cross-module side effects go through domain events.

## Data ownership

One Postgres database (`sales_platform`), one Postgres **schema per domain
module** (`identity`, `crm`, `leads`, `sales`, `products`, `quotes`,
`support`, `subscriptions`, `notifications`).
This gives each module a
real, enforced data boundary (a `crm` module literally cannot query
`identity.users` without going through the identity module's service) while
staying one physical database to run and back up. If a module ever needs to
become its own deployed service, its schema is already isolated — the split
is "point it at its own database and stand up its own process," not "figure
out which tables belong to whom."

Every table carries: `id (uuid)`, `organization_id`, `created_at`,
`updated_at`, `created_by`, `updated_by`, and `deleted_at` where soft delete
applies — per Section 17 of the brief.

## Multi-tenancy & auth

- JWT access token (short-lived) + rotating refresh token, issued by the
  identity module. No external IdP in Phase 1 (see ADR 0001) — the token
  contract is designed so a later Keycloak/OIDC swap only touches the
  identity module's issuing code, not every other module's guards.
- `organizationId`, `userId`, and permissions are **never** read from the
  request body/params. A `TenantContextMiddleware` resolves them from the
  verified JWT and attaches them to an async-local-storage-backed request
  context; repositories require an explicit `organizationId` argument sourced
  only from that context.
- Authorization is permission-string based (`crm.accounts.view`, not role
  names), matching Section 19. Roles are just named bundles of permissions.
  Three system roles are seeded per organization on creation: `Owner`,
  `Admin`, `Member`.

## Events

Domain actions publish a typed envelope through `DomainEventBus`:

```ts
{ eventId, eventType, timestamp, organizationId, actorId, correlationId, payload }
```

This is delivered in-process (`@nestjs/event-emitter`), consumed by the
audit listener. The publish API is shaped so that swapping the transport
for RabbitMQ later (Phase 8+, if/when a module is extracted into its own
service) does not change any producer or consumer code — only
`DomainEventBus`'s internals change.

Phase 1 events: `organization.created`, `user.created`, `user.invited`,
`user.role_assigned`, `user.login_succeeded`, `user.login_failed`.
Phase 2 events: `account.created/updated/deleted`,
`contact.created/updated/deleted`, `activity.logged/updated/deleted`.
Phase 3 events: `lead.created/updated/status_changed/converted/deleted`,
`lead.scoring_rule_created/updated/deleted`.
Phase 4 events: `opportunity.created/updated/stage_changed/won/lost/deleted`,
`pipeline.created/updated/deleted`, `stage.created/updated/deleted`.
Phase 5 events: `product.created/updated/deleted`,
`quote.created/updated/sent/accepted/rejected/expired/revised/deleted`,
`quote_template.created/updated/deleted`.
Phase 6 events: `ticket.created/updated/status_changed/assigned/
comment_added/deleted`, `sla_policy.created/updated/deleted`,
`kb_article.created/updated/published/deleted`.
Phase 7 events: `plan.created/updated/deleted`,
`subscription.created/updated/cancelled/renewed/lapsed/deleted/
renewal_reminder_sent`.
Phase 8 introduced no new event types — its automation (quote acceptance
auto-advancing a linked Opportunity's stage) is a second producer of the
existing `opportunity.stage_changed`/`opportunity.won` events, and
`quote.accepted`'s payload gained one field (`opportunityId`) so the
listener has something to act on. See [ADR 0008](../decisions/0008-analytics-automation-phase8-scope.md).
Phase 9 likewise introduced no new event types — `opportunity.won`/
`opportunity.lost`/`quote.accepted`/`quote.rejected` payloads each gained an
`ownerId` field so `NotificationsListener` has a recipient to act on. See
[ADR 0009](../decisions/0009-notifications-phase9-scope.md).

## Audit

Every mutating action is recorded to an append-only `identity.audit_log`
table (user, organization, event type, payload, timestamp, IP, user agent,
request id, correlation id) via `AuditListener`, an `@OnEvent("domain.event")`
wildcard listener on the same event bus — per Section 14. Every module's
events land here automatically; no per-module audit code is needed. The
CRM module's account/contact timeline (see below) reads a filtered subset
of this same table rather than maintaining its own history. As of Phase 10,
`GET /audit-log` (`identity/audit`, gated on the `audit.log.view` permission)
exposes this same table to the dashboard, filtered and paginated — see
[ADR 0010](../decisions/0010-audit-log-ui-phase10-scope.md). As of Phase 11,
`GET /audit-log/export` returns the same filtered rows as CSV (capped at
`AUDIT_LOG_EXPORT_MAX_ROWS`, currently 10,000 — see
[ADR 0011](../decisions/0011-audit-log-csv-export-phase11-scope.md)). As of
Phase 12, `GET /audit-log/stream` (SSE) pushes a lightweight signal — not
the full row — whenever a new matching entry is written, so the dashboard
can offer a live "new events" refresh instead of requiring a manual reload;
see [ADR 0012](../decisions/0012-audit-log-streaming-phase12-scope.md).

## What's deferred, and the trigger to add it back

| Deferred            | Add it when...                                            |
|----------------------|-----------------------------------------------------------|
| RabbitMQ              | A module is actually split into its own deployed service. |
| Keycloak / OIDC        | External SSO customers are a real, committed requirement.  |
| Temporal               | A workflow needs durable multi-day orchestration with retries beyond what a scheduled job table covers. Phase 7's renewal reminders confirmed a Postgres job table + `@nestjs/schedule` is still enough — see [ADR 0007](../decisions/0007-subscriptions-phase7-scope.md). |
| OpenSearch             | Postgres full-text search stops being fast enough at real data volume. |
| Separate databases per module | A module needs independent scaling/ownership by a separate team. |
| Notification delivery preferences/settings, email digests of notifications | A concrete need for per-user delivery control shows up — Phase 9 built the in-app bell/unread-state center itself, see [ADR 0009](../decisions/0009-notifications-phase9-scope.md). |

## Phase 1 scope

Identity & Access: organizations, users, teams, roles, permissions, auth
(register/login/refresh/logout), tenant isolation, RBAC guards, audit log,
health check, OpenAPI docs, and a Next.js shell (login/register + protected
dashboard layout with the full nav from the brief).

## Phase 2 scope

CRM: accounts, contacts, activities (calls/emails/meetings/notes/tasks), a
customer timeline that merges logged activities with account/contact
domain events (read-time merge, not a dedicated table — see
`TimelineService` — so Phase 4+ modules slot in by publishing events with
an `accountId` payload and being added to `TIMELINE_EVENT_TYPES`, no schema
change required), and Postgres `tsvector`+GIN full-text search across
accounts/contacts (`SearchService` — the one place raw SQL is used, since
Drizzle has no `tsquery`/`@@` operator support). New permissions:
`crm.contacts.*`, `crm.activities.*` (`crm.accounts.*` was already reserved
in Phase 1). Documents and custom fields were deliberately deferred — see
[ADR 0002](../decisions/0002-crm-phase2-scope.md). Leads, Sales, Quotes,
etc. are Phase 3+, per the brief's own phased plan.

## Phase 3 scope

Leads: lead CRUD, a configurable scoring rule engine (`field` + `operator`
+ `value` + `points`, evaluated as a pure function — see
`evaluate-lead-score.ts`, the one unit-tested domain module so far, per
Section 30's explicit call for lead-scoring unit tests), fixed lead
sources with a per-source breakdown page, a qualification state machine
(`New/Contacted/Qualified/Unqualified/Converted`, guarded by
`assertValidLeadTransition`), and conversion into a reused-or-created
Account + Contact (duplicate detection by case-insensitive exact
name/email match) inside one cross-schema transaction — `LeadsService`'s
one deliberate exception to the "cross-module writes via events only"
rule above, documented in
[ADR 0003](../decisions/0003-leads-phase3-scope.md). `lead.converted` was
also added to `TIMELINE_EVENT_TYPES`, the first real use of the extension
point Phase 2's `TimelineService` was built for — a converted lead's
account timeline shows the conversion with zero changes to the timeline
query itself. Scoring rules can't reference behavioral signals like page
visits — recorded as a deliberate scope cut in ADR 0003, not a gap to
silently work around. (Conversion not creating an Opportunity was also
recorded there as deferred — Phase 4 closes it, see below.)

## Phase 4 scope

Sales Pipeline: Opportunities, org-configurable Pipelines/Stages (each org
gets a lazily-seeded default pipeline with the brief's 6 example stages —
`PipelinesService.getOrCreateDefault()` — the first configurable-workflow
feature in the system, extending Leads' "configurable scoring rules"
precedent), a Kanban board (`/sales/pipeline`, native HTML5 drag-and-drop,
no new dependency), a Forecast/analytics page (`/sales/forecast`, using
Recharts — installed since Phase 1 per the brief's stack list, unused
until now), and Activities scoped to a specific opportunity (extends
`crm.activities` with a nullable, unconstrained `opportunity_id` — see
[ADR 0004](../decisions/0004-sales-phase4-scope.md) for why it's
unconstrained). Stage moves have no fixed transition graph (stages are
user-defined) — the only guards are "stay within the opportunity's own
pipeline" and "closed (won/lost-flagged) stages are terminal," per §35.
Four `opportunity.*` event types were added to `TIMELINE_EVENT_TYPES`, the
second real use of that extension point after `lead.converted`. Lead
conversion (`LeadsService.convert()`) now also creates an Opportunity,
extending its existing cross-schema-transaction exception from ADR 0003
rather than introducing a new one — closing the gap that ADR explicitly
deferred. Products/line-items and file attachments on an Opportunity are
not modeled yet (Phase 5 and undetermined, respectively — Phase 5 closes
the products half, see below), and deeper dashboards/reporting stay out of
scope until Phase 8 — both recorded in
[ADR 0004](../decisions/0004-sales-phase4-scope.md).

## Phase 5 scope

Quotations: two new modules, `products` (catalog + volume-based price
tiers — `ProductsService.priceFor()`, a small config-driven suggestion, not
a discount rules engine) and `quotes` (quotes, versions, templates, PDF,
public acceptance). A quote's line items snapshot the product's name/price
at add-time rather than live-joining it, so a later price change or
product deletion never changes an already-created quote. While `draft`, a
quote is freely edited in place; once `sent`, it's locked and can only be
reopened via `POST /quotes/:id/revise`, which clones the latest version
into a new one and preserves the old one immutably — the first genuinely
versioned/immutable document in the system, a deliberate departure from
every prior module's plain-mutable-PATCH pattern. `POST /quotes/:id/send`
generates a share link rather than sending an email (no SMTP dispatch code
existed yet at the time — Phase 6 closes this gap, see below);
`PublicQuotesController` is the first
unauthenticated, customer-facing surface in the app, looked up by an
opaque `shareToken` rather than by id+JWT, with events published via an
explicit `organizationId` since there's no request context to source one
from. PDFs (`pdfkit`) are generated on demand from data already in
Postgres, not stored — `quote-pdf.ts`'s `buildQuotePdf()` is a pure
function over a plain data snapshot, unit-tested the same way as
`evaluate-lead-score.ts`. Four `quote.*` event types were added to
`TIMELINE_EVENT_TYPES`, the third real use of that extension point after
`lead.converted` and Phase 4's `opportunity.*` events. Accepting a quote
does not auto-advance its linked Opportunity's stage — recorded as a
Phase-8-automation deferral, not a silent gap. All of the above, plus
lazy (touch-on-access) quote expiry and globally-sequential quote numbers,
are recorded in [ADR 0005](../decisions/0005-quotations-phase5-scope.md).

## Phase 6 scope

Support: Tickets, SLA policies, and an internal Knowledge Base, plus the
first outbound email dispatch in the codebase. A ticket's SLA due-dates
(`firstResponseDueAt`/`resolutionDueAt`) are snapshotted from the matching
`sla_policies` row (one per organization+priority) at creation time — same
"snapshot, not live reference" reasoning as quote line items — and SLA
breach is a pure, read-time computed flag (`ticket-sla.ts`'s
`computeTicketSlaFlags()`, unit-tested like `evaluate-lead-score.ts`), never
persisted, since nothing needs to *transition* on a breach the way a quote
transitions to `expired`. Ticket status is a fixed transition graph
(`open/in_progress/resolved/closed`, always reopenable), reusing Leads'
pattern rather than Opportunities' — the same class of call ADR 0005 made
for quote status. The Knowledge Base is internal-only in this phase — no
public, unauthenticated help-center view — recorded as a deliberate scope
cut, not a gap, in [ADR 0006](../decisions/0006-support-phase6-scope.md).
`MailerService`/`MailListener` (`apps/api/src/shared/mail/`) are new
cross-cutting infrastructure in `SharedModule`, structurally identical to
`AuditListener`: an `@OnEvent`-driven listener that never breaks the
business operation that triggered it. Publishing services (`TicketsService`,
`QuotesService`) enrich their own event payloads with everything an email
needs — recipient address/name, ready-built links — so the mail listener
itself has no database or cross-module service dependencies. This closes
the deferral Phase 5 left open: `QuotesService.send()` now emails the
quote's contact its public link, fulfilling ADR 0005's decision #7. Three
`ticket.*` event types were added to `TIMELINE_EVENT_TYPES`, the fourth real
use of that extension point after `lead.converted`, Phase 4's
`opportunity.*` events, and Phase 5's `quote.*` events. Inbound
email-to-ticket parsing (a customer replying by email to add a ticket
comment) is out of scope — recorded in ADR 0006 as a materially bigger,
deliberately deferred feature.

## Phase 7 scope

Subscriptions: Plans, Subscriptions, and Renewals — an internal
subscription-lifecycle tracker, not a billing system (no payment
processing at all this phase — see
[ADR 0007](../decisions/0007-subscriptions-phase7-scope.md)). A
subscription snapshots its plan's name/price/billing interval at creation
time, the same "snapshot, not live reference" reasoning used for quote
line items (ADR 0005) and ticket SLA due-dates (ADR 0006); a later plan
price edit never changes an existing subscription's rate, and there's no
plan upgrade/downgrade path yet. Status is a small fixed set (`active`/
`lapsed`/`cancelled` — no `trialing`, a deliberate scope cut): lapsing is
lazy and read-time, reusing `QuotesService.expireIfDue()`'s exact
"touch-on-access" pattern via `subscription-lapse.ts`'s pure, unit-tested
`isLapseDue()`; `cancel`/`renew` are explicit actions checked inline,
closer to Quotes' `send`/`accept`/`reject` than to Leads/Tickets' generic
transition-map guard, since there are only two branchy actions here.
Renewal reminders are the first scheduled/background process in the
codebase: a `renewal_reminders` Postgres job table, polled every 15
minutes by `@nestjs/schedule`'s `@Cron` (`RenewalsScheduler` →
`RenewalsService.processDueReminders()`), confirming ADR 0001's own
"a scheduled job table covers renewal reminders" call rather than reaching
for Redis/BullMQ/Temporal. The scheduler publishes its own enriched event
with an explicit `organizationId` (there's no request context on a timer
tick — `DomainEventBus.publish()` already supported this) and a fourth
`MailListener` handler sends the actual email, keeping mail-dispatch logic
centralized exactly as Phase 6 set it up. `subscriptions.manage` — reserved
since Phase 1 with no defined meaning — now narrows to Plan mutations
only, continuing Phase 6's `support.tickets.manage` narrowing move. Four
`subscription.*` event types were added to `TIMELINE_EVENT_TYPES`, the
fifth real use of that extension point after `lead.converted`, Phase 4's
`opportunity.*`, Phase 5's `quote.*`, and Phase 6's `ticket.*` events.

## Phase 8 scope

Analytics & Automation — the last of the three items the brief's Section 36
named for this phase, synthesized from scattered ADR breadcrumbs since
there was no `ComingSoon` stub confirming its shape this time (see
[ADR 0008](../decisions/0008-analytics-automation-phase8-scope.md) for the
full reasoning). Three separable pieces:

**Analytics** — a new `analytics` module (`GET /analytics/dashboard`,
gated by a newly added `analytics.view` permission) that reads
`sales.opportunities`/`subscriptions.subscriptions` directly rather than
injecting `OpportunitiesService`/`SubscriptionsService`, the same
direct-cross-schema-read precedent Quotes/Support/Subscriptions already set
for reading `crm.accounts`/`crm.contacts` — applied here for the first time
across two already-built top-level domains. Returns exactly the 7 metrics
the dashboard home page's own placeholder card named: open/weighted
pipeline value, win rate, open-opportunity count, MRR, ARR, and active-
subscription count.

**Automation** — one concrete, named piece: accepting a quote linked to an
Opportunity now auto-advances that Opportunity to its pipeline's win stage.
Lives as a `QuoteAcceptedListener` inside `sales/automation/`, reacting to
the existing `quote.accepted` event (which gained one payload field,
`opportunityId`) rather than Quotes calling into Sales directly — inverting
the dependency direction ADR 0005 decision #9 was careful to avoid. Reuses
`moveStage`'s exact update/event shape via two small dedicated methods
(`PipelinesService.findWinStage`, `OpportunitiesService.
autoAdvanceOnQuoteAccepted`), so an automated stage move is indistinguishable
from a manual one on the account timeline, with zero Timeline code changes.

**Advanced search** — `pg_trgm` fuzzy (typo-tolerant) ranking blended into
the existing `SearchService`'s full-text queries, plus Leads onboarded as a
third searchable type (gated on `leads.view`, not included by default so
the Accounts page's existing typeahead is unaffected). No new frontend
surface consumes the `lead` search type yet — a deliberate backend-ahead-
of-frontend cut, recorded rather than silently left half-built.

Out of scope, explicitly: payment/billing automation beyond what Phase 7
already covers, any additional cross-module automations beyond the one the
brief named, and the `notifications` module (see the deferred-tech table
above).

## Phase 9 scope

Notifications — unlike every prior phase, no ADR/plan/`ComingSoon` stub
named "Phase 9" anywhere in the repo; the scope was chosen directly by the
user from the two items that had some evidence (see
[ADR 0009](../decisions/0009-notifications-phase9-scope.md) for the full
reasoning). A new `notifications` module (new schema, one table) creates an
in-app notification for a bounded, evidenced set of 5 existing events —
`ticket.assigned`, `opportunity.won`, `opportunity.lost`, `quote.accepted`,
`quote.rejected` — each already carrying a single clear recipient
(`assigneeId`/a newly added `ownerId` payload field), skipping self-triggered
actions. `NotificationsListener` lives inside its own module rather than
`SharedModule`, reacting across `SalesModule`/`QuotesModule` with no import
relationship — the same cross-module-listener precedent Phase 8's
`QuoteAcceptedListener` established. The API is authenticated-only with no
new permission (every query is scoped to the caller's own `userId`, the
same precedent `GET /auth/me` already set) — the first user-scoped rather
than org-scoped resource in the app. The frontend gets a bell icon in
`AppTopbar` with a polled (not pushed) unread-count badge and a dropdown of
recent notifications. Delivery preferences/settings and an email digest of
notifications are explicitly out of scope — recorded as a deferral, not a
gap.

## Phase 10 scope

Audit Log UI — the runner-up candidate from Phase 9's scope question (see
[ADR 0010](../decisions/0010-audit-log-ui-phase10-scope.md) for the full
reasoning). The audit trail and its permission (`audit.log.view`) have
existed since Phase 1; this phase adds the missing read side: a new
`identity/audit` submodule (`GET /audit-log`, filterable by `eventType`/
`actorId`/date range, `limit`/`offset` paginated — the app's first paginated
endpoint) and a real dashboard page replacing the `ComingSoon` stub, with a
filter bar, a Prev/Next pager, and a "View details" dialog that pretty-prints
each event's raw payload. No new permission, no new event types, no schema
change — purely additive read surface over data that already existed.

## Phase 11 scope

Audit Log CSV export — the "CSV/export" item [ADR 0010](../decisions/0010-audit-log-ui-phase10-scope.md)
point 7 explicitly deferred, picked up on request (see
[ADR 0011](../decisions/0011-audit-log-csv-export-phase11-scope.md) for the
full reasoning). A new `GET /audit-log/export` endpoint reuses the existing
list filters and a 10,000-row cap (`AUDIT_LOG_EXPORT_MAX_ROWS`,
`packages/contracts/src/audit.ts`) — above the cap it returns `400` rather
than building an unbounded response, since `audit_log` is the one table in
the app that grows forever. A small shared CSV encoder
(`apps/api/src/shared/csv/to-csv.ts`) and the audit-specific row shaping/cap
check (`apps/api/src/modules/identity/audit/audit-export.ts`) are both pure,
unit-tested functions, not wired to the database — the same "pure builder,
unit-tested standalone" split Phase 5's `quote-pdf.ts` established. The
dashboard page gained an "Export CSV" button (a plain `<a href>` download,
matching the Quote PDF pattern), disabled automatically once the current
filters match more rows than the cap allows. No new permission — reuses
`audit.log.view`. Export of any other list is out of scope for this phase.

## Phase 12 scope

Audit Log real-time streaming — the "real-time streaming" item
[ADR 0010](../decisions/0010-audit-log-ui-phase10-scope.md) point 7
explicitly deferred, picked up on request (see
[ADR 0012](../decisions/0012-audit-log-streaming-phase12-scope.md) for the
full reasoning). The app's first real-time push transport: a new
`GET /audit-log/stream` SSE endpoint on `AuditController`, built on
NestJS's `@Sse()` decorator and the existing in-process `EventEmitter2` bus
`AuditListener` already writes through — no new dependency, no WebSocket.
`AuditListener` emits a lightweight `audit.log.entry.created` signal
(`{ organizationId, eventType, actorId, createdAt }`, not the full row)
right after each successful insert; the stream endpoint filters that signal
by the caller's organization and the same `eventType`/`actorId`/date-range
query filters the list/export endpoints already accept
(`matchesAuditStreamFilters`, a pure, unit-tested function in
`apps/api/src/modules/identity/audit/audit-stream.ts`, mirroring Phase 11's
`audit-export.ts` split). The dashboard only opens the stream while viewing
the newest page (`offset === 0`) and reacts to a matching signal with a
"New audit events — Refresh" banner that refetches the existing list query,
rather than splicing pushed data directly into the table — sidestepping
pagination correctness entirely. The BFF gateway
(`apps/web/src/app/api/gateway/[...path]/route.ts`) gained a streaming
branch that pipes `text/event-stream` responses through live instead of
buffering them, since the browser's `EventSource` must go through the same
cookie-authenticated gateway as every other request. No new permission —
reuses `audit.log.view`. In-process delivery means this doesn't fan out
across multiple API instances if the app is ever horizontally scaled — an
explicit, documented limitation, not a gap; that's the concrete trigger for
Redis pub/sub or RabbitMQ later. Live push for any other list, or for
notifications (which ADR 0009 deliberately kept polling-only), is out of
scope for this phase.
