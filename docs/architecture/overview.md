# Architecture Overview

See [ADR 0001](../decisions/0001-modular-monolith.md) for why this is a
modular monolith rather than microservices, and what it takes to split a
module into a real service later. See [ADR 0002](../decisions/0002-crm-phase2-scope.md)
for what Phase 2 (CRM) deliberately left out, and
[docs/plans/0002-phase2-crm-plan.md](../plans/0002-phase2-crm-plan.md) for
the full Phase 2 implementation plan (data model, timeline/search design,
sequencing).

## System shape

```text
apps/web        Next.js app (App Router). Talks only to apps/api.
apps/api        NestJS modular monolith — this IS the API gateway for now.
                One process, one Postgres database, module-per-domain.
packages/*      Code shared between web and api (types, validation, config).
```

```text
apps/api/src/modules/
  identity/       organizations, users, teams, roles, permissions, auth
  crm/            accounts, contacts, activities, timeline, search
  shared/         tenant context, event bus, audit listener, guards
  (leads, sales, quotes, products, support, subscriptions,
   notifications — added in later phases, same pattern)
```

Every module follows: `Controller -> Application Service -> Domain Logic ->
Repository -> Database`. No module imports another module's repository or
Drizzle schema directly — cross-module reads go through the other module's
exported service; cross-module side effects go through domain events.

## Data ownership

One Postgres database (`sales_platform`), one Postgres **schema per domain
module** (`identity`, later `crm`, `leads`, ...). This gives each module a
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

## Audit

Every mutating action is recorded to an append-only `identity.audit_log`
table (user, organization, event type, payload, timestamp, IP, user agent,
request id, correlation id) via `AuditListener`, an `@OnEvent("domain.event")`
wildcard listener on the same event bus — per Section 14. Every module's
events land here automatically; no per-module audit code is needed. The
CRM module's account/contact timeline (see below) reads a filtered subset
of this same table rather than maintaining its own history.

## What's deferred, and the trigger to add it back

| Deferred            | Add it when...                                            |
|----------------------|-----------------------------------------------------------|
| RabbitMQ              | A module is actually split into its own deployed service. |
| Keycloak / OIDC        | External SSO customers are a real, committed requirement.  |
| Temporal               | A workflow needs durable multi-day orchestration with retries beyond what a scheduled job table covers. |
| OpenSearch             | Postgres full-text search stops being fast enough at real data volume. |
| Separate databases per module | A module needs independent scaling/ownership by a separate team. |

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
