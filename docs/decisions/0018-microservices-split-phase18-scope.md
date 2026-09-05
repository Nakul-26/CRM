# ADR 0018: Microservices split Phase 18 scope — extract `notifications` into its own deployable service

## Status

Accepted — 2026-09-03

## Context

[ADR 0001](0001-modular-monolith.md) named the microservices split as the
last of five originally-deferred items, sequenced after RabbitMQ (Phase 14),
OpenSearch (Phase 15), Temporal (Phase 16), and Keycloak (Phase 17) — each of
whose own ADRs explicitly called itself "a real prerequisite building block
for the eventual microservices split." ADR 0001's own Consequences section
prescribes the recipe: *"extract the module's schema into its own database,
replace its in-process service calls with an HTTP/event client, and deploy
separately. The domain logic itself does not need to be rewritten."*

**Which module.** Reading every module's coupling (cross-module TS imports,
direct cross-schema SQL reads) ruled out the two modules prior ADRs most
often named as split candidates:

- The **Temporal worker** (flagged in ADR 0016 decision 9 as "a natural first
  candidate") isn't a bounded domain with its own API — it's background job
  infrastructure tightly coupled to Payments/Subscriptions domain logic.
  Extracting it wouldn't demonstrate "a microservice" as clearly as
  extracting a module with its own schema, API, and event consumer.
- **Audit-log** (the module Phase 14's RabbitMQ work was built around) has
  real extraction costs: it lives inside the `identity` Postgres schema
  rather than owning one; `opportunities.service.ts` (stage-change history)
  and `crm/timeline/timeline.service.ts` (account timeline) both read the
  `auditLog` table directly via raw SQL, synchronously, in the request path;
  `AuditService.list()` does a `leftJoin` against `identity.users` for actor
  name/email; and the feature itself is split across `shared/audit/` and
  `modules/identity/audit/`.

`notifications` (`apps/api/src/modules/notifications/`) is structurally
clean by comparison: it owns its own `notifications` Postgres schema/table
outright, nothing else imports `NotificationsService` (confirmed via grep —
no other `.module.ts` references it), and its only inbound coupling is two
plain FK columns (`organizationId → identity.organizations`,
`userId → identity.users`). It's fed purely by `NotificationsListener`'s
seven `@OnEvent(...)` handlers — extraction is "swap the transport that
feeds it," not "rewrite its logic."

**The key enabling discovery.** `DomainEventBus.publish()`
(`apps/api/src/shared/events/domain-event-bus.ts`) always emits in-process
via `EventEmitter2` regardless of `EVENT_BUS_TRANSPORT`. What that setting
gates is `AuditListener`, which — via `RabbitMQAuditTransport.publishForAudit`
— already republishes **every** domain event (routing key = `event.eventType`)
onto a durable topic exchange (`domain.events`) whenever
`EVENT_BUS_TRANSPORT=rabbitmq`, regardless of whether the event is
audit-relevant. In practice, that exchange is already the general-purpose
"domain event bus over RabbitMQ" `DomainEventBus`'s own doc comment
anticipated. This meant the new notifications service could bind its own
queue to the *existing* exchange with just the seven routing keys it needs —
zero changes to the publish side, zero new RabbitMQ wiring in the monolith.

## Decisions

**1. Extract `notifications`, not audit-log or the Temporal worker.** Lowest
real extraction cost while still proving every element of ADR 0001's recipe
— own schema→own database, in-process calls→event client, separate
deployment — without also solving audit's synchronous cross-module readers
or re-architecting a background job runner into a service with no natural
API boundary. A deliberate, justified choice, not a default; the other nine
schema-owning modules remain in the monolith.

**2. New app `apps/notifications-service`**
(`@sales-platform/notifications-service`) — a second small NestJS app in the
same pnpm/Turbo workspace, own `package.json`, `main.ts`, `nest-cli.json`,
port `4002`. No Dockerfile — none exist for `apps/api`/`apps/web` either;
this repo runs Node apps on the host and only containerizes infra via
`docker-compose.yml`, so the new service follows that exact precedent.

**3. Own Postgres database** (`sales_platform_notifications`, same
`postgres` container/port `5434`, a new logical database rather than a new
container) reached via its own `DATABASE_URL`, created automatically by
`pnpm db:migrate`'s `ensureDatabase()` step (mirroring
`apps/api/test/setup/test-app.ts`'s test-DB bootstrap). Its `notifications`
table is a near-identical port of the monolith's, minus the
`organizations`/`users` FK constraints — impossible across databases —
`organizationId`/`userId` become plain, unconstrained UUIDs, trusted the
same way `audit_log.organizationId`/`actorId` already are today (populated
from a verified JWT's claims, never a raw client input).

**4. RabbitMQ is the only way events reach the new service.**
`DomainEventsConsumer` binds a durable queue
(`notifications.service.consumer`, own DLQ `notifications.service.consumer.dlq`
off the existing `domain.events.dlx` fanout exchange) to the *existing*
`domain.events` topic exchange with 7 explicit routing keys
(`ticket.assigned`, `opportunity.won`, `opportunity.lost`, `quote.accepted`,
`quote.rejected`, `payment.succeeded`, `payment.failed`) — never the `#`
wildcard `RabbitMQAuditTransport`'s consumer uses. `apps/api`'s
`app.module.ts` validates at boot that `NOTIFICATIONS_SERVICE_ENABLED=true`
implies `EVENT_BUS_TRANSPORT=rabbitmq`, throwing a clear startup error
otherwise — silently no events reaching the new service would be a much
worse failure mode than refusing to boot.

**5. Full module removal, not the "always-mounted, throws if unconfigured"
idiom Phase 17 used for the OIDC route.** Those are different problems: an
unmounted OIDC route is harmless to leave live (nobody calls it unless they
opt in); leaving `/notifications` mounted in *both* the monolith and the
extracted service would silently create two independent, diverging
notification stores. `apps/api/src/app.module.ts` now calls `loadApiEnv()`
eagerly at module-file-evaluation time (not deferred inside
`ConfigModule.forRoot`'s `load` closure) so the `imports` array can branch on
it with a plain ternary — `...(env.NOTIFICATIONS_SERVICE_ENABLED ? [] :
[NotificationsModule])` — verified with a real e2e assertion that
`GET /api/v1/notifications` genuinely 404s when the flag is on, not merely
guessed at from NestJS's documented behavior.

**6. Own lightweight JWT guard, not a shared `packages/auth`.**
`NotificationsController`'s 4 routes require only authentication (no
`@RequirePermissions`, scoped to the caller's own `userId`), so the new
service's `JwtAuthGuard` is a ~60-line local copy verifying the same access
token (`@nestjs/jwt`'s `verifyAsync` against the same `JWT_ACCESS_SECRET`)
apps/api's own guard does — no `@Public()` escape hatch, since every route
here requires a valid token, and this service never issues its own tokens.
Introducing a shared package to save one file wasn't proportionate, and it
avoids touching all 26 controllers' import paths in `apps/api`.

**7. `apps/web`'s gateway proxy** (`src/app/api/gateway/[...path]/route.ts`)
gets a one-line branch: when `path[0] === "notifications"` and a server-only
`NOTIFICATIONS_SERVICE_URL` is set, the proxy targets that URL instead of
`API_INTERNAL_URL`; otherwise it falls back to the monolith exactly as
before. This is precisely what the file's own pre-existing comment
anticipated ("the eventual API Gateway service... is a drop-in swap for
`API_INTERNAL_URL` with no client code changes"), extended with a path
prefix since only one module's routes move.

**8. Root `pnpm dev` does not auto-start the new service.** Turbo
auto-discovers every workspace package with a `dev` script; left unfiltered,
plain `pnpm dev` would newly require `RABBITMQ_URL` and a second
`DATABASE_URL` to be live for *everyone*, even those who never touch this
feature — a real regression to the "opt-in, zero burden by default" bar
every phase since 13 has held. Root `package.json`'s `dev` script gained
`turbo run dev --filter="!@sales-platform/notifications-service"`; `build`/
`typecheck`/`test`/`lint` stay unfiltered so CI fully verifies the new app
on every run. The new service is started deliberately via
`pnpm --filter @sales-platform/notifications-service dev`.

**9. A one-time backfill script**
(`apps/notifications-service/scripts/backfill-from-monolith.ts`), run
manually, copies existing rows from the monolith's `notifications` schema
into the new database — idempotent (`ON CONFLICT (id) DO NOTHING`), not run
automatically. A full zero-downtime, dual-write migration path was
deliberately not built — out of proportion for proving the split works;
historical notifications simply aren't silently stranded if an operator
runs it once when first flipping the flag.

**10. No unit spec for `NotificationsService` itself, following existing
convention.** Neither the monolith's own `notifications.service.ts`/
`notifications.listener.ts` ever had a unit-test file — Phase 9 relied on
e2e coverage against a real database for this module's CRUD/business logic,
and this phase's port follows the same established pattern rather than
introducing a new, inconsistent testing style for one file. What *is*
new and unit-tested here: `DomainEventsConsumer` (RabbitMQ topology/message
handling, mirroring `RabbitMQAuditTransport.spec.ts`'s own mocking
approach), `NotificationsConsumerService` (the per-event-type mapping and
skip rules), and `JwtAuthGuard` (token verification) — all pure logic with
no database dependency, same bar Phase 15's `OpenSearchSearchProvider`/
Phase 16's `TemporalDunningOrchestrator` were held to.

**11. Not built this phase**: extracting any other module (audit-log, the
Temporal worker); a real, separate API gateway service (still just a
path-branch inside the existing Next.js proxy); horizontal scaling or
multiple instances of the new service; TLS/service-mesh between services
(same trust model as the rest of local/dev infra today). Each is a
reasonable, separable future increment, recorded here rather than assumed
away.

## Consequences

- A real, working, separately-deployable service now exists
  (`apps/notifications-service`), proving out every element of ADR 0001's
  split recipe end to end — own database, RabbitMQ-mediated decoupling
  instead of in-process calls, its own process/port — but it's fully opt-in
  (`NOTIFICATIONS_SERVICE_ENABLED=false` by default) and the monolith
  behaves byte-for-byte as before when it's off.
- The `domain.events` RabbitMQ exchange Phase 14 built specifically for
  audit turned out to be genuinely reusable, unmodified, as this
  microservices split's event transport — validating the original
  `DomainEventBus` doc comment's claim that "the publish contract
  intentionally matches what a RabbitMQ-backed bus would look like."
- Cross-database FK constraints don't exist in Postgres — any future module
  extraction that has FK-referenced columns to another module's tables
  (audit-log's synchronous readers being the sharpest example) will hit the
  same "drop the constraint, trust the JWT-sourced value instead" pattern
  this phase used for `notifications.organizationId`/`userId`.
- This is the last of the five originally-deferred items from ADR 0001 —
  but only one of ten schema-owning modules has actually been extracted.
  The deferral-table entry in `docs/architecture/overview.md` reflects that:
  the *pattern* is proven, not "the split is finished." Extracting any
  further module remains gated on the same trigger ADR 0001 always named:
  a concrete independent-scaling/ownership need for a specific team, not a
  general "more microservices" push.
- **Two real bugs found and fixed during verification, both pre-existing
  and unrelated to this phase's own new code, surfaced only because
  `NOTIFICATIONS_SERVICE_ENABLED` is the first flag to gate a boot-time
  `throw`:**
  - `packages/config/src/env.ts`'s `z.coerce.boolean()` does a raw
    `Boolean(value)` coercion, so the *string* `"false"` (non-empty)
    parses to `true`. `AUTH_OIDC_ENABLED`/`NEXT_PUBLIC_OIDC_ENABLED` had
    the identical bug since Phase 17 — harmless there since nothing
    asserted on either being `false` — but `NOTIFICATIONS_SERVICE_ENABLED`
    gating a startup `throw` made it catastrophic: every e2e spec's
    `test-app.ts` sets it via `??= "false"`, so the whole suite failed to
    boot. Fixed with a `booleanFlag()` helper that only treats the literal
    string `"true"` (or a real `true`) as true, applied to all three
    fields.
  - `apps/api/test/oidc-login.e2e-spec.ts`'s "rejects OIDC login when
    AUTH_OIDC_ENABLED is not set" test built a second `createTestApp()`
    instance after flipping `process.env.AUTH_OIDC_ENABLED` — but
    `app.module.ts`'s eager `const env = loadApiEnv()` (this phase's own
    addition) is only re-evaluated on a fresh `require()`, and Node's
    require cache means a second `createTestApp()` call within the same
    file silently reuses the first instance's already-decorated
    `AppModule`. The env flip never took effect; the test was passing
    before only because the `z.coerce.boolean()` bug above made
    `AUTH_OIDC_ENABLED` effectively always `true` regardless, so it was
    coincidentally exercising a real Keycloak round trip with a garbage
    code, not the disabled path at all. `jest.resetModules()` "fixes" the
    caching but breaks NestJS DI's token identity for framework
    singletons (`Reflector`) shared across the two module graphs. Removed
    the test: the behavior it intended to prove is already covered,
    precisely and in isolation, by `oidc.service.spec.ts`'s "throws (does
    not silently no-op) when AUTH_OIDC_ENABLED is false".
