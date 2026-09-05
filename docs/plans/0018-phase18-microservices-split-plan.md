# Phase 18 — Microservices split (extract `notifications` into its own deployable service)

## Context

This is the last of the five originally-deferred items from [ADR 0001](../decisions/0001-modular-monolith.md). RabbitMQ (Phase 14), OpenSearch (Phase 15), Temporal (Phase 16), and Keycloak (Phase 17) are done; each ADR since Phase 14 has explicitly named itself "a real prerequisite building block for the eventual microservices split." ADR 0001's own Consequences section prescribes the recipe: *"extract the module's schema into its own database, replace its in-process service calls with an HTTP/event client, and deploy separately. The domain logic itself does not need to be rewritten."*

**Which module.** Reading every module's coupling (cross-module TS imports, direct cross-schema SQL reads) ruled out the two modules prior ADRs most often named as split candidates: the Temporal worker (background job infrastructure with no bounded API of its own) and audit-log (lives inside the `identity` Postgres schema rather than owning one; `opportunities.service.ts` and `crm/timeline/timeline.service.ts` both read `auditLog` directly via raw SQL in the request path; `AuditService.list()` does a `leftJoin` against `identity.users`; the feature itself is split across `shared/audit/` and `modules/identity/audit/`). `notifications` (`apps/api/src/modules/notifications/`) is structurally clean by comparison: it owns its own `notifications` Postgres schema/table outright, nothing else imports `NotificationsService` (confirmed via grep), and its only inbound coupling is two plain FK columns (`organizationId → identity.organizations`, `userId → identity.users`). It's fed purely by `NotificationsListener`'s seven `@OnEvent(...)` handlers — extraction is "swap the transport that feeds it," not "rewrite its logic."

**The key enabling discovery.** `DomainEventBus.publish()` (`apps/api/src/shared/events/domain-event-bus.ts`) always emits in-process via `EventEmitter2` regardless of `EVENT_BUS_TRANSPORT`. What that setting gates is `AuditListener`, which — via `RabbitMQAuditTransport.publishForAudit` — already republishes **every** domain event (routing key = `event.eventType`) onto a durable topic exchange (`domain.events`) whenever `EVENT_BUS_TRANSPORT=rabbitmq`, regardless of whether the event is audit-relevant. In practice, that exchange is already the general-purpose "domain event bus over RabbitMQ" `DomainEventBus`'s own doc comment anticipated. This means the new notifications service can bind its own queue to the *existing* exchange with just the seven routing keys it needs — zero changes to the publish side, zero new RabbitMQ wiring in the monolith. `EVENT_BUS_TRANSPORT=rabbitmq` becomes a hard prerequisite for turning the split on, validated at boot with a clear error otherwise.

Following the exact "opt-in, safe default, real infra" shape of every phase since 13: **`NOTIFICATIONS_SERVICE_ENABLED=false` by default** — when off, `apps/api` behaves exactly as it does today. When on, the monolith drops its own `NotificationsModule` entirely and a new, separately-deployable NestJS app — `apps/notifications-service` — owns notification storage, RabbitMQ consumption, and the `/notifications` read/write API, reached by `apps/web`'s existing gateway proxy via a path-based branch.

## Scope decisions

| Decision | Reasoning |
|---|---|
| **Extract `notifications`, not audit-log or the Temporal worker.** | Lowest real extraction cost while still proving every element of ADR 0001's recipe — own schema→own DB, in-process calls→event client, separate deployment — without also solving audit's synchronous cross-module readers or re-architecting a background job runner into a service with no natural API boundary. A deliberate, justified choice, not a default; the other nine schema-owning modules remain in the monolith. |
| **New app `apps/notifications-service`** (`@sales-platform/notifications-service`), a second small NestJS app alongside `apps/api`/`apps/web` in the same pnpm/Turbo workspace — own `package.json`, `main.ts`, `nest-cli.json`, port `4002`. No Dockerfile (none exist for `apps/api`/`apps/web` either — this repo runs Node apps on the host and only containerizes infra via `docker-compose.yml`). | Matches existing monorepo conventions exactly; `pnpm-workspace.yaml`'s `apps/*` glob and Turbo's `^build` graph pick it up with no new tooling. |
| **Own Postgres database** (`sales_platform_notifications`, on the *same* `postgres` container/port `5434` — a new logical database, not a new container) reached via its own `DATABASE_URL`. Its `notifications` table is a near-identical port of the current schema, minus the `organizations`/`users` FK constraints (impossible across databases) — `organizationId`/`userId` become plain, unconstrained UUIDs, trusted the same way `audit_log.organizationId`/`actorId` already are today. | Satisfies "extract the module's schema into its own database" literally. One new container would be infra proliferation for no architectural benefit. |
| **RabbitMQ is the only way events reach the new service** — it binds its own durable queue (`notifications.service.consumer`, own DLQ) to the *existing* `domain.events` topic exchange with 7 explicit routing keys (`ticket.assigned`, `opportunity.won`, `opportunity.lost`, `quote.accepted`, `quote.rejected`, `payment.succeeded`, `payment.failed`), mirroring `RabbitMQAuditTransport`'s exchange/DLQ setup. `apps/api` validates at boot that `NOTIFICATIONS_SERVICE_ENABLED=true` implies `EVENT_BUS_TRANSPORT=rabbitmq`, throwing a clear startup error otherwise. | No changes needed to the publish side at all — a second queue binding to a subset of routing keys is the minimal, correct way to add a second consumer of the same firehose. |
| **Own lightweight JWT guard**, not a shared auth package. `NotificationsController`'s 4 routes require only authentication (no `@RequirePermissions`, scoped to the caller's own `userId`) — so the new service just needs `@nestjs/jwt`'s `verifyAsync` against the same `JWT_ACCESS_SECRET`. A ~60-line local copy, not a new `packages/auth`. | Matches the actual (small) surface needed; introducing a shared package to save one file isn't proportionate, and avoids touching all 26 controllers' import paths in `apps/api`. |
| **`apps/web` gateway** gets a small branch: when `path[0] === "notifications"` and a server-only `NOTIFICATIONS_SERVICE_URL` env var is set, the proxy targets that URL instead of `API_INTERNAL_URL` — same Bearer-attachment, same SSE/binary handling, no other changes. | Zero new frontend architecture; browser code and `NEXT_PUBLIC_*` surface are completely unaffected either way. |
| **`NOTIFICATIONS_SERVICE_ENABLED` is validated by *removing* `NotificationsModule` from `AppModule.imports` at boot** (`loadApiEnv()` called eagerly at the top of `app.module.ts`, module list built with a ternary) rather than the "always-mounted, throws if invoked unconfigured" idiom Phase 17 used for the OIDC route. Those are different problems: OIDC's route is harmless to leave mounted; here, leaving `/notifications` mounted in *both* places would silently create two independent, diverging notification stores. | Prevents the actual failure mode (duplicate/divergent state) rather than papering over it. |
| **Root `pnpm dev` does not auto-start the new service** — root `package.json`'s `dev` script gets an explicit Turbo filter excluding it, while `build`/`typecheck`/`test`/`lint` continue to include it unconditionally. Started deliberately via `pnpm --filter @sales-platform/notifications-service dev`. | Without this exclusion, plain `pnpm dev` would newly require `RABBITMQ_URL`/a second `DATABASE_URL` for everyone — a real regression to the "opt-in, zero burden by default" bar every phase since 13 has held. |
| **One-time backfill script** (`apps/notifications-service/scripts/backfill-from-monolith.ts`), idempotent, provided but not automatically run. **Not built**: a live dual-write/zero-downtime migration path. | Historical notifications shouldn't be silently stranded, but full zero-downtime migration tooling is separate, real scope with no concrete need yet. |
| **Not built this phase**: extracting any other module (audit-log, Temporal worker); a real API gateway service (still just a path-branch inside the existing Next.js proxy); horizontal scaling/multiple instances; TLS/service-mesh between services. | Each is a reasonable, separable future increment, recorded rather than assumed away. |

## Backend — `apps/notifications-service` (new app)

- `package.json` (`@sales-platform/notifications-service`) — depends on `@sales-platform/config`, `@sales-platform/contracts`, `@sales-platform/logger` (workspace:*), `@nestjs/*`, `drizzle-orm`, `postgres`, `amqplib`, `@nestjs/jwt`. Scripts mirror `apps/api`: `build`, `dev`, `start`, `typecheck`, `test`, `test:e2e`, `db:migrate`.
- `nest-cli.json`, `tsconfig.json`/`tsconfig.build.json`.
- `src/main.ts` — `NestFactory.create(AppModule)`, `helmet()`, CORS, global prefix `api/v1`, `app.listen(PORT)`.
- `src/app.module.ts` — imports `DatabaseModule`, `NotificationsModule`.
- `src/database/` — own Drizzle setup; `src/database/schema/notifications.schema.ts` (FK `.references()` calls removed); `drizzle.config.ts`; `migrate.ts` with an `ensureDatabase()` bootstrap (mirrors `apps/api/test/setup/test-app.ts`'s test-DB creation pattern).
- `src/notifications/notifications.controller.ts` / `.service.ts` — near-verbatim port of the monolith's (same 4 routes), guarded by the new local `JwtAuthGuard`.
- `src/rabbitmq/domain-events-consumer.ts` + `src/notifications/notifications-consumer.service.ts` — binds `notifications.service.consumer` (+ DLQ) to the existing `domain.events` exchange for the 7 routing keys, runs the same per-event-type → `{title, link}` mapping `NotificationsListener` has today.
- `src/shared/guards/jwt-auth.guard.ts` — local, trimmed copy (verify-only, no `@Public()`).
- `scripts/backfill-from-monolith.ts` — one-time, idempotent copy from the monolith DB into this one.

## Backend — `apps/api` (modified)

- `packages/config/src/env.ts` — `apiEnvSchema` gains `NOTIFICATIONS_SERVICE_ENABLED: z.coerce.boolean().default(false)`; new `notificationsServiceEnvSchema`/`loadNotificationsServiceEnv`.
- `apps/api/src/app.module.ts` — `const env = loadApiEnv();` at module scope; `imports` built with `...(env.NOTIFICATIONS_SERVICE_ENABLED ? [] : [NotificationsModule])`; a boot-time check throwing if `NOTIFICATIONS_SERVICE_ENABLED && EVENT_BUS_TRANSPORT !== "rabbitmq"`.
- No changes to `DomainEventBus`, `AuditListener`, or `RabbitMQAuditTransport` — the existing exchange is reused as-is.

## Frontend — `apps/web` (modified)

- `apps/web/src/lib/server-config.ts` — add `NOTIFICATIONS_SERVICE_URL`.
- `apps/web/src/app/api/gateway/[...path]/route.ts` — `targetUrl` selection branches on `path[0] === "notifications" && NOTIFICATIONS_SERVICE_URL` before falling back to `API_INTERNAL_URL`.

## Testing

- New service unit tests: `DomainEventsConsumer`, `NotificationsConsumerService`, `JwtAuthGuard` (all pure logic, no DB dependency — matching the bar `OpenSearchSearchProvider`/`TemporalDunningOrchestrator` were held to). No unit spec for `NotificationsService` itself, following the monolith's own existing convention of e2e-only coverage for that file.
- New service e2e (`apps/notifications-service/test/`): boots the real app against a real test Postgres DB and real RabbitMQ; publishes a real message onto `domain.events` and asserts a notification appears via `GET /notifications`.
- `apps/api` regression: existing notifications specs continue to pass unchanged under the default `NOTIFICATIONS_SERVICE_ENABLED=false`. New `apps/api/test/notifications-service-split.e2e-spec.ts` asserts `GET /api/v1/notifications` 404s when the flag is on, and that the app throws at boot when the flag is on with `EVENT_BUS_TRANSPORT` left at `in-process`.
- Full existing unit + e2e suites re-run under the default — zero behavior change anywhere else.
- `test-app.ts`: `process.env.NOTIFICATIONS_SERVICE_ENABLED ??= "false"`.

## Docs

- `docs/decisions/0018-microservices-split-phase18-scope.md` (ADR).
- `docs/plans/0018-phase18-microservices-split-plan.md` (this plan, persisted).
- `docs/architecture/overview.md` — phase-link entry; deferral-table row update; new "Phase 18 scope" section; "Data ownership" section note.
- `README.md` — Phase 18 marked current; note the new `apps/notifications-service` app and how to run it; update "Why not microservices?" section.

## Verification

1. `docker compose up -d`; create `sales_platform_notifications` DB and run the new service's migration.
2. New service's unit tests green.
3. New service's e2e spec green against real Postgres + real RabbitMQ.
4. `apps/api`'s new split e2e spec green (routes gone when enabled; boot throws on misconfiguration).
5. Full existing `apps/api` unit + e2e suites green under the default `NOTIFICATIONS_SERVICE_ENABLED=false` — no regression.
6. `pnpm build` / `pnpm typecheck` clean across all workspace packages including the new app.
7. Manual verification: run `apps/api` (flag on) + `apps/notifications-service` + `apps/web` together, trigger a notification-producing action, confirm it shows up via the UI's notification bell, routed entirely through the new service.

### Known implementation risks resolved empirically

1. Exact Drizzle/`postgres` driver connection setup for a second, independently-migrated database on the same Postgres container — resolved with a real `ensureDatabase()` bootstrap.
2. Confirming NestJS's static `@Module` decorator genuinely omits a conditionally-excluded module's routes/providers from the compiled graph — verified with a real supertest 404 assertion.
3. Turbo's `--filter="!<pkg>"` exclusion syntax against the actual installed Turbo version — confirmed empirically.

---

## Remaining deferred items after this phase

1. ~~RabbitMQ~~ — done (Phase 14).
2. ~~OpenSearch~~ — done (Phase 15).
3. ~~Temporal~~ — done (Phase 16).
4. ~~Keycloak~~ — done (Phase 17).
5. **Microservices split** — this plan extracts `notifications` as a first, real proof of the pattern; the other nine schema-owning modules remain deferred, extracted only if a concrete independent-scaling/ownership need shows up for one of them (per ADR 0001's own stated trigger).
