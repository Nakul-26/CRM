# Sales Platform

Enterprise sales management platform — CRM, Lead Management, Sales Pipeline,
Quotations, Customer Support, and Subscriptions — built as a **modular
monolith** (see [docs/decisions/0001-modular-monolith.md](docs/decisions/0001-modular-monolith.md)
for why, and how it evolves into microservices later if that's ever needed).

**Phase 1:** Identity & Access — organizations, users, teams, roles,
permission-based RBAC, JWT auth, tenant isolation, audit logging.

**Phase 2:** CRM — accounts, contacts, activities, a customer timeline, and
full-text search.

**Phase 3:** Leads — lead CRUD, configurable scoring rules, sources,
qualification, and conversion into Accounts/Contacts (and, as of Phase 4,
an Opportunity) with duplicate detection.

**Phase 4:** Sales Pipeline — opportunities, org-configurable
pipelines/stages with a Kanban board, forecast/analytics, and
opportunity-scoped activities.

**Phase 5:** Quotations — a product catalog with volume-based price tiers,
versioned quotes (locked once sent, revised via explicit new versions),
reusable templates, on-demand PDF generation, and a public, unauthenticated
share-link flow for a customer to view/accept/reject a quote.

**Phase 6:** Support — tickets with SLA policies (response/
resolution targets snapshotted per ticket, breach flags computed at read
time), an internal knowledge base, and the platform's first outbound email
dispatch (via Mailpit in dev) — a sent quote now emails its contact the
public link, and tickets email their contact on creation and on public
replies.

**Phase 7:** Subscriptions — Plans, Subscriptions (snapshotting
their plan's price/interval at creation, same as Quotes/Support), and
Renewals: a `renewal_reminders` Postgres job table polled every 15 minutes
by the platform's first scheduled background process, emailing a
subscription's contact ahead of its renewal date. No payment processing —
renewal is a manual "extend the period" action.

**Phase 8:** Analytics & Automation — a dashboard home page with
real cross-entity metrics (pipeline value, win rate, MRR/ARR); one
concrete automation (accepting a quote linked to an Opportunity
auto-advances that Opportunity to its pipeline's win stage); and advanced
search — typo-tolerant fuzzy matching plus Leads onboarded as a searchable
type.

**Phase 9:** Notifications — an in-app notification center. A
bounded set of events (ticket assignment, an opportunity won/lost, a quote
accepted/rejected) notifies the right person — never the person who just
took the action themself — via a bell icon in the dashboard topbar with a
live unread-count badge.

**Phase 10:** Audit Log UI — the audit trail and its permission
have existed since Phase 1; this phase adds the missing read side: a
filterable, paginated `GET /audit-log` endpoint and a real dashboard page
(filter bar, pager, per-event JSON payload viewer) replacing the old
`ComingSoon` stub.

**Phase 11:** Audit Log CSV Export — the "CSV/export" item
deliberately deferred when Phase 10 shipped. A `GET /audit-log/export`
endpoint reuses the same filters as the list endpoint and returns a CSV
(capped at 10,000 matching rows), with an "Export CSV" button on the
dashboard page that disables itself once the current filters exceed that
cap.

**Phase 12:** Audit Log Real-Time Streaming — the "real-time
streaming" item deliberately deferred when Phase 10 shipped. A new
`GET /audit-log/stream` SSE endpoint (the app's first real-time push
transport, built on the existing in-process event bus, no new dependency)
pushes a lightweight signal whenever a new audit row matching the current
filters is written; the dashboard shows a "New audit events — Refresh"
banner while viewing the newest page, instead of requiring a manual reload.

**Phase 13:** Payment Processing — the "no payment
processing" item Phase 7 deliberately deferred. A new, pluggable
`PaymentProvider` (a real Stripe Checkout adapter plus a deterministic mock
used by default, `PAYMENT_PROVIDER=mock|stripe`, fully testable with no
external account) powers a new `POST /payments/checkout` for paying to
renew a subscription — the existing free "extend the period" renewal stays
available alongside it.

**Phase 14:** RabbitMQ — the first of the five originally-deferred
infrastructure items (RabbitMQ, Keycloak, Temporal, OpenSearch,
microservices split), picked up on request. Scoped to one concrete need:
`AuditListener`'s DB write previously had no retry — a failed insert was
silently lost. A new `EVENT_BUS_TRANSPORT=in-process|rabbitmq` env var
(default `in-process`, every other listener untouched) routes audit writes
through a durable queue with a dead-letter queue instead, when enabled. See
[docs/architecture/overview.md](docs/architecture/overview.md) for the full
picture and
[docs/architecture/overview.md#phase-14-scope](docs/architecture/overview.md#phase-14-scope)
for exactly what's built vs. deferred.

**Phase 15:** OpenSearch — the second of the five
originally-deferred infrastructure items. A real, pluggable
`SearchProvider` (a genuine OpenSearch-backed adapter with fuzzy
multi-field matching plus the existing Postgres `ts_rank`/`pg_trgm` search
kept as-is, `SEARCH_PROVIDER=postgres|opensearch`, default `postgres` since
Postgres search hasn't actually hit its documented scaling trigger yet) can
power `GET /search`. A new `SearchIndexListener` keeps the OpenSearch index
in sync off the existing domain event bus, with automatic fallback to
Postgres if OpenSearch fails. See
[docs/architecture/overview.md#phase-15-scope](docs/architecture/overview.md#phase-15-scope)
for exactly what's built vs. deferred.

**Phase 16 (current):** Temporal — the third of the five
originally-deferred infrastructure items. A real, pluggable
`DunningOrchestrator` (`WORKFLOW_ENGINE=in-process|temporal`, default
`in-process`) retries a failed subscription renewal charge up to 3 times
with day-scale backoff, then cancels the subscription if every retry
fails — closing a real gap where a failed charge previously produced one
email and then silence. The default backend polls a Postgres job table on
a cron, mirroring the existing renewal-reminder job's shape; the opt-in
Temporal backend runs the same schedule as a real, durable workflow. See
[docs/architecture/overview.md#phase-16-scope](docs/architecture/overview.md#phase-16-scope)
for exactly what's built vs. deferred.

## Prerequisites

- Node.js >= 20
- pnpm >= 9 (`corepack enable` gives you this automatically)
- Docker Desktop (for Postgres/Redis/Mailpit; RabbitMQ, OpenSearch, and
  Temporal are optional — only needed if you set `EVENT_BUS_TRANSPORT=
  rabbitmq`, `SEARCH_PROVIDER=opensearch`, or `WORKFLOW_ENGINE=temporal`)

## Getting started

```bash
pnpm install

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Then edit apps/api/.env and set real JWT_ACCESS_SECRET / JWT_REFRESH_SECRET:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up -d          # Postgres, Redis, Mailpit (+ RabbitMQ, OpenSearch, Temporal, optional)
pnpm --filter @sales-platform/api db:migrate

pnpm dev                      # builds shared packages, then starts api + web
```

- Web app: http://localhost:3000
- API: http://localhost:4000/api/v1
- API docs (Swagger): http://localhost:4000/api/docs
- Mailpit (dev email capture — quote-sent, ticket, and renewal-reminder notifications land here): http://localhost:8025

Register the first organization at http://localhost:3000/register — that
account becomes the org's Owner with every permission.

## Testing

```bash
pnpm --filter @sales-platform/api test        # unit tests, no database needed
pnpm --filter @sales-platform/api test:e2e    # integration tests — needs docker compose up -d
```

The e2e suite creates/migrates its own `sales_platform_test` database on the
same Postgres container automatically; it won't touch your dev data.

## Repository layout

```text
apps/
  web/     Next.js app — the only thing the browser talks to
  api/     NestJS modular monolith (identity, crm, leads, sales, products, quotes, support, subscriptions, analytics, notifications modules)
packages/
  contracts/   Zod schemas + shared TS types (auth, permissions, events, errors)
  config/      Zod-validated environment loading
  logger/      Structured logging (pino)
docs/
  architecture/   System overview
  decisions/      ADRs
```

## Why not [Keycloak / microservices]?

Deliberately deferred for now — see the ADR linked above for the reasoning
and the concrete trigger for adding each one back.

RabbitMQ is partially adopted as of Phase 14: the audit pipeline can run
through a durable queue (`EVENT_BUS_TRANSPORT=rabbitmq`), but every other
listener still uses the in-process event bus, and that stays the default.
General adoption is deferred for the same reason as before — see
[ADR 0014](docs/decisions/0014-rabbitmq-audit-transport-phase14-scope.md).

OpenSearch is fully built as of Phase 15 — a real, working
`SEARCH_PROVIDER=opensearch` adapter with feature parity to the default
Postgres search — but Postgres remains the default, since the documented
trigger (search volume outgrowing Postgres) hasn't actually fired. See
[ADR 0015](docs/decisions/0015-opensearch-phase15-scope.md).

Temporal is adopted as of Phase 16 for one concrete workflow — subscription
payment dunning (`WORKFLOW_ENGINE=temporal`) — but the default
`in-process` (Postgres cron) backend implements the identical retry
schedule with no new infrastructure, and the renewal-reminder job stays on
its own simple cron job as ADR 0007 already established. General adoption
for other multi-step processes is deferred until one has a concrete need —
see [ADR 0016](docs/decisions/0016-temporal-dunning-phase16-scope.md).
