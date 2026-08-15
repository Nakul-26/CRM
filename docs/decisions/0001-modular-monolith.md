# ADR 0001: Start as a modular monolith, not microservices

## Status

Accepted — 2026-08-14

## Context

The original product brief specified a full microservices architecture from
day one: 11+ independently deployed services (CRM, Leads, Sales, Quotation,
Support, Subscription, Product, Notification, Audit, Workflow, Identity),
each with its own Postgres database, communicating over RabbitMQ, fronted by
an API gateway, with Keycloak for identity, Temporal for workflows, and
OpenSearch for global search.

That architecture is a reasonable *destination* for a platform with multiple
teams and real independent-scaling needs. It is the wrong *starting point*
for a solo/small-team build of a product that doesn't exist yet, because:

- **The core domains are not actually independent.** Lead conversion writes
  an Account + Contact + Opportunity in one operation. A Quote reads Products
  and Pricing inline. Splitting these into separate services with separate
  databases turns single-transaction operations into distributed sagas
  before there's any load or team-ownership reason to pay that cost.
- **Operational overhead compounds immediately.** 9 databases, RabbitMQ,
  Keycloak, Temporal, and OpenSearch all need to be stood up, migrated,
  secured, and kept running just to authenticate a single user — before a
  single sales feature exists.
- **Premature service boundaries are hard to undo.** Wrong microservice
  splits are far more expensive to fix than wrong module splits inside one
  codebase, because they require data migration across databases, not just
  moving code.

## Decision

Build a **modular monolith**: one NestJS application (`apps/api`) with
strict module boundaries mirroring the eventual service boundaries
(`identity`, `crm`, `leads`, `sales`, `quotes`, `products`, `support`,
`subscriptions`, `notifications`, `audit`), one Postgres database with one
schema-owning module per domain, and an in-process domain event bus with the
same typed event envelope (`eventId`, `eventType`, `timestamp`,
`organizationId`, `actorId`, `correlationId`, `payload`) the original spec
required for RabbitMQ. Modules only reach another module's data through its
public service interface or its domain events — never through direct
repository access — exactly as the "no cross-service database access" rule
requires, just enforced by module boundaries instead of network boundaries.

Deferred until there is a concrete need:
- **RabbitMQ** — the in-process event bus is API-compatible in shape; a
  later swap publishes the same envelopes onto a broker instead of an
  `EventEmitter`.
- **Keycloak** — a first-party JWT + refresh-token auth module covers
  Phase 1–5. Keycloak/OIDC federation is a real future need once external
  SSO customers show up, not a day-1 one.
- **Temporal** — no workflow in Phase 1–5 actually needs durable long-running
  orchestration; a Postgres-backed job table covers renewal reminders etc.
  until that changes.
- **OpenSearch** — Postgres full-text search (`tsvector`) covers Phase 1–7
  search volume.

## Consequences

- Faster to build, run, and reason about solo; one `docker compose up`
  brings up the whole dev environment.
- Module boundaries are enforced by lint rules and code review now, not by
  the network — slightly weaker isolation guarantee than real microservices,
  compensated by keeping the boundaries mechanical (one module = one schema
  = one owner).
- Splitting a module into its own deployable service later is a matter of:
  extract the module's schema into its own database, replace its in-process
  service calls with an HTTP/event client, and deploy separately. The domain
  logic itself does not need to be rewritten.
- Multi-tenancy, RBAC, audit logging, and the event-per-domain-action rule
  are enforced identically to the original spec — only the transport
  changes, not the domain rules.
