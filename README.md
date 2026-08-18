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

**Phase 10 (current):** Audit Log UI — the audit trail and its permission
have existed since Phase 1; this phase adds the missing read side: a
filterable, paginated `GET /audit-log` endpoint and a real dashboard page
(filter bar, pager, per-event JSON payload viewer) replacing the old
`ComingSoon` stub. See
[docs/architecture/overview.md](docs/architecture/overview.md) for the full
picture and
[docs/architecture/overview.md#phase-10-scope](docs/architecture/overview.md#phase-10-scope)
for exactly what's built vs. deferred.

## Prerequisites

- Node.js >= 20
- pnpm >= 9 (`corepack enable` gives you this automatically)
- Docker Desktop (for Postgres/Redis/Mailpit)

## Getting started

```bash
pnpm install

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Then edit apps/api/.env and set real JWT_ACCESS_SECRET / JWT_REFRESH_SECRET:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up -d          # Postgres, Redis, Mailpit
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

## Why not [RabbitMQ / Keycloak / Temporal / OpenSearch / microservices]?

Deliberately deferred for now — see the ADR linked above for the reasoning
and the concrete trigger for adding each one back.
