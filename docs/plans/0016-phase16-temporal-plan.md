# Phase 16 — Temporal (durable dunning workflow for failed subscription payments)

## Context

[ADR 0001](../decisions/0001-modular-monolith.md) deferred Temporal on day one. [ADR 0007](../decisions/0007-subscriptions-phase7-scope.md) revisited it for renewal reminders specifically and confirmed a Postgres job table + `@nestjs/schedule` was sufficient — that reminder job is a single poll-and-fire step, not something a workflow engine would meaningfully improve. RabbitMQ (Phase 14) and OpenSearch (Phase 15) are done; Temporal is next per the user's standing instruction to work through all five originally-deferred items.

**The concrete need driving scope** (confirmed by reading the code): `PaymentsService.handleFailed` (`apps/api/src/modules/payments/payments.service.ts`) marks a payment failed and publishes `payment.failed` — and that is the *entire* response today. One email goes out (`notifications.listener.ts`), and then nothing: no grace period, no retry, no automatic transition toward cancellation. A subscription with a permanently failing card just sits there indefinitely. This is a genuine gap, and "wait days, retry N times with backoff, cancel on exhaustion" is the canonical shape Temporal exists for — durable multi-day state that survives process restarts, which a cron+flag table can only approximate.

Given that, this phase builds a **real dunning workflow** — retry a failed renewal charge up to 3 times with day-scale backoff (1 day / 3 days / 7 days), then cancel the subscription if all retries fail — with **two interchangeable orchestration backends** selected by `WORKFLOW_ENGINE=in-process|temporal` (default `in-process`, needs no new infrastructure). This mirrors the exact "pluggable provider, safe default" shape of Phases 13–15, with one difference worth being explicit about: unlike Postgres/OpenSearch (where one implementation is "the original code, untouched"), *neither* dunning backend exists today, so both are new — but they must produce the same business outcome (same retry count, same backoff schedule, same eventual cancel), differing only in which system tracks the waiting and retrying.

## Scope decisions

| Decision | Reasoning |
|---|---|
| **New `WORKFLOW_ENGINE=in-process\|temporal` env var** (default `in-process`), plus `TEMPORAL_ADDRESS`/`TEMPORAL_NAMESPACE` (optional, only read when `temporal`) — exact mirror of `EVENT_BUS_TRANSPORT`/`SEARCH_PROVIDER`. | Same shape as every prior provider phase; zero new dependency by default. |
| **One `DunningOrchestrator` interface**, two implementations: `PostgresDunningOrchestrator` (default) and `TemporalDunningOrchestrator`, selected via a factory provider exactly like `PAYMENT_PROVIDER`'s. Both live under `apps/api/src/modules/payments/dunning/orchestrators/`, inside `PaymentsModule` (which already imports `SubscriptionsModule` — keeping dunning here avoids a circular module dependency). | Consistent location/DI shape with every prior pluggable capability. |
| **A `DunningListener`** (`@OnEvent("payment.failed")`/`@OnEvent("payment.succeeded")`, sibling to `AuditListener`/`SearchIndexListener`) is the one place dunning "starts." It asks *the same orchestrator it is about to act through* whether a cycle is already active (`orchestrator.hasActiveCycle(subscriptionId)`), then starts or continues via that same orchestrator. If the active orchestrator is `temporal` and either call throws, it falls back to running the *entire* decision-and-action through `PostgresDunningOrchestrator`. | No new publish call sites — reuses the existing `payment.failed`/`payment.succeeded` events. Deciding and acting through the same orchestrator (never mixing one's read with another's write) avoids a state-mismatch bug — see the implementation note below. |
| **Shared business logic in `DunningActionsService`**, injected with `PaymentsService`/`SubscriptionsService`: `attemptCharge` (calls the existing, safely re-invokable `PaymentsService.startCheckout`) and `cancelSubscription` (calls `SubscriptionsService.cancel`). Both orchestrators call only these two methods. | One source of truth for "what a dunning attempt/exhaustion actually does," shared by the cron poller and the Temporal activities. |
| **Shared retry policy** (`dunning-policy.ts`): `MAX_DUNNING_ATTEMPTS = 3`, production backoff `[1 day, 3 days, 7 days]`, overridable via `DUNNING_RETRY_DELAYS_MS` for e2e tests only. Both orchestrators import this one policy. | Guarantees both backends produce the identical business schedule; the override is the only way a genuine multi-attempt e2e test can finish in seconds. |
| **`PostgresDunningOrchestrator`**: a `dunning_cycles` table (`payments` schema) tracks `subscriptionId`, `latestPaymentId`, `attemptNumber`, `nextAttemptAt`, `status`, with a partial unique index limiting one active cycle per subscription. A `DunningScheduler` (`@Cron`, mirrors `RenewalsScheduler`) polls due rows and fires the next attempt; a no-op when `WORKFLOW_ENGINE=temporal`. | The only way to implement day-scale waiting without new infrastructure — reuses the cron+Postgres-table shape ADR 0007 already validated. |
| **`TemporalDunningOrchestrator`**: a lazily-constructed `@temporalio/client` connection (mirrors `RabbitMQAuditTransport`'s idiom) starts a `dunningWorkflow`, workflow ID `dunning:${subscriptionId}` — natural idempotency via Temporal's workflow-ID uniqueness. Its `hasActiveCycle` asks the workflow's own execution state (`describe().status.name === "RUNNING"`), not a shadow table. The workflow itself (`workflows/dunning.workflow.ts`) is minimal: sleep, call `attemptChargeActivity`, `condition()`-wait for a `paymentResolved` signal, stop on success; `cancelSubscriptionActivity` on exhaustion. Activities (`workflows/dunning.activities.ts`) are thin wrappers around `DunningActionsService`. | Textbook Temporal use case. Keeping workflow code minimal and pushing business logic into activities respects Temporal's determinism constraints. Asking the workflow's own state (rather than duplicating it in Postgres) avoids a second source of truth to keep in sync. |
| **The Worker runs in-process**, not a separate deployment — `TemporalWorkerService` (`OnModuleInit`/`OnModuleDestroy`) starts a `@temporalio/worker` `Worker` only when `WORKFLOW_ENGINE=temporal`. | Matches this app's modular-monolith architecture; splitting the worker out is exactly what the eventual microservices-split phase would do, not this one. Also the only way a single Jest e2e process can exercise a genuine start→execute→signal→complete round trip. |
| **`docker-compose.yml`** gains a `temporal` service (`temporalio/auto-setup:1.24`, pointed at the existing shared `postgres` container, port shifted to `7234:7233`) and `temporal-ui` (port `8081`). Two version-specific quirks verified and fixed empirically: `DB=postgresql` is invalid (must be `DB=postgres12`), and the server only binds/advertises on its own container IP, not loopback (healthcheck resolves `$(hostname -i)` first). | Real infra, not a mock — matches every prior opt-in dependency. Quirks resolved the same "verify against a real container" way as RabbitMQ's healthcheck and OpenSearch's admin-password requirement. |
| **Not built this phase**: migrating the renewal-reminder cron onto Temporal (ADR 0007's reasoning still holds); a dunning-cycle UI beyond Temporal's own Web UI; configurable per-plan retry policies; Temporal for anything beyond dunning. | Each is a reasonable, separable future increment, recorded here rather than silently gapped. |

## Backend

### `docker-compose.yml`
Add a `temporal` service (`temporalio/auto-setup:1.24`, `DB=postgres12` pointed at the existing `postgres` service/credentials, port shifted to `7234:7233`, healthcheck via `temporal operator cluster health --address $(hostname -i):7233`), plus `temporal-ui` (port `8081:8080`).

### Env — `packages/config/src/env.ts`
```ts
WORKFLOW_ENGINE: z.enum(["in-process", "temporal"]).default("in-process"),
TEMPORAL_ADDRESS: z.string().optional(),
TEMPORAL_NAMESPACE: z.string().optional(),
DUNNING_RETRY_DELAYS_MS: z.string().optional(), // comma-separated ms, test override only
```

### `apps/api/package.json`
Add `@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`, `@temporalio/activity`, `@temporalio/common` (dependencies).

### `apps/api/src/modules/payments/dunning/` (new directory)
- `dunning-policy.ts` — `MAX_DUNNING_ATTEMPTS`, `getDunningRetryDelaysMs()`.
- `dunning-actions.service.ts` — `DunningActionsService`.
- `dunning.listener.ts` — `DunningListener`.
- `orchestrators/dunning-orchestrator.interface.ts` — `DunningOrchestrator` interface (`hasActiveCycle`, `startDunning`, `recordAttemptOutcome`), `DUNNING_ORCHESTRATOR` token.
- `orchestrators/postgres-dunning.orchestrator.ts`, `orchestrators/temporal-dunning.orchestrator.ts`.
- `dunning.scheduler.ts` — `DunningScheduler`.
- `workflows/dunning.workflow.ts`, `workflows/dunning.activities.ts`.
- `temporal-worker.service.ts` — `TemporalWorkerService`.

### `apps/api/src/modules/payments/payments.module.ts` (existing, modified)
Register the new dunning providers, the `DUNNING_ORCHESTRATOR` factory, `DunningListener`, `DunningScheduler`, `TemporalWorkerService`.

### Database migration
New `dunning_cycles` table (`payments` schema) via the existing Drizzle migration flow.

## Testing

- **Unit**: `dunning-policy.spec.ts`, `dunning-actions.service.spec.ts`, `postgres-dunning.orchestrator.spec.ts`, `temporal-dunning.orchestrator.spec.ts` (`jest.mock("@temporalio/client")`), `dunning.listener.spec.ts` (locks in the fallback and the "same orchestrator decides and acts" invariant), `dunning.scheduler.spec.ts`.
- **New e2e**: `apps/api/test/dunning-temporal.e2e-spec.ts` — sets `WORKFLOW_ENGINE=temporal`, `TEMPORAL_ADDRESS`, and a short `DUNNING_RETRY_DELAYS_MS` override before importing `./setup/test-app`; drives two real round trips against the live server + in-process worker (recovers on retry; exhausts and cancels).
- **Dropped**: a `@temporalio/testing` time-skipping workflow unit test — the ephemeral test server proved flaky across repeated invocations in this environment (a second run left it unreachable with no recovery). The real e2e test already exercises the identical workflow logic against a live, persistent server, so the flaky dependency was removed rather than kept as a source of CI flakiness.
- **Regression**: full existing unit (129/129) and e2e suites re-run under the default `WORKFLOW_ENGINE=in-process` — zero regressions.
- `test-app.ts`: `process.env.WORKFLOW_ENGINE ??= "in-process"`.

## Docs

- `docs/decisions/0016-temporal-dunning-phase16-scope.md`.
- `docs/plans/0016-phase16-temporal-plan.md` (this plan, persisted).
- `docs/architecture/overview.md` — phase-link entry, deferral-table row update, new "Phase 16 scope" section.
- `README.md` — Phase 16 marked current (Phase 15 loses it); prerequisites/getting-started notes mention Temporal is optional.

## Verification

1. `docker compose up -d temporal temporal-ui`, confirm healthy.
2. Unit tests green (32 dunning tests, 129 total).
3. New e2e spec green against the real server + in-process worker (both scenarios: recovery and exhaustion).
4. Full existing unit + e2e suites green under the default `WORKFLOW_ENGINE=in-process` (no regression).
5. `pnpm --filter @sales-platform/api build` clean.

### Critical files
- `apps/api/src/modules/payments/dunning/` (new directory)
- `apps/api/src/modules/payments/payments.module.ts` (existing) — provider/listener/scheduler wiring
- `packages/config/src/env.ts` (existing) — `WORKFLOW_ENGINE`, `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `DUNNING_RETRY_DELAYS_MS`
- `docker-compose.yml` (existing) — new `temporal`/`temporal-ui` services
- `apps/api/test/dunning-temporal.e2e-spec.ts` (new)
- New Drizzle migration for `dunning_cycles`

---

## Remaining deferred items after this phase

1. ~~RabbitMQ~~ — done (Phase 14).
2. ~~OpenSearch~~ — done (Phase 15).
3. ~~Temporal~~ — done (this phase).
4. **Keycloak** — swap first-party JWT/refresh-token auth for OIDC federation; most invasive of the remaining items (touches every module's auth).
5. **Microservices split** — extracting one or more modules into separately deployable services, last, per ADR 0001's own "Consequences" section. The in-process Temporal worker built this phase is a natural first candidate to later split out.
