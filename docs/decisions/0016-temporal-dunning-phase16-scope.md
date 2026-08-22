# ADR 0016: Temporal Phase 16 scope — a durable dunning workflow, Postgres/cron stays default

## Status

Accepted — 2026-08-22

## Context

[ADR 0001](0001-modular-monolith.md) deferred Temporal from day one.
[ADR 0007](0007-subscriptions-phase7-scope.md) revisited it specifically for
renewal reminders and confirmed a Postgres job table + `@nestjs/schedule`
was sufficient — that reminder job is a single poll-and-fire step with no
multi-attempt/backoff semantics, so a workflow engine wouldn't have
meaningfully improved it. RabbitMQ (Phase 14) and OpenSearch (Phase 15) are
done; Temporal is next per the user's standing instruction to work through
all five originally-deferred items.

**The concrete need driving scope** (confirmed by reading the code):
`PaymentsService.handleFailed` (`apps/api/src/modules/payments/payments.service.ts`)
marks a payment failed and publishes `payment.failed` — and that is the
entire response today. One email goes out
(`notifications.listener.ts`), and then nothing: no grace period, no retry,
no automatic transition toward cancellation. A subscription with a
permanently failing card just sits there indefinitely. "Wait days, retry N
times with backoff, cancel on exhaustion" — payment dunning — is the
canonical shape Temporal exists for: durable multi-day state that survives
process restarts, which a cron+flag table can only approximate.

## Decisions

**1. New `WORKFLOW_ENGINE=in-process|temporal` env var** (default
`in-process`), plus `TEMPORAL_ADDRESS`/`TEMPORAL_NAMESPACE` (optional, only
read when `temporal`) and `DUNNING_RETRY_DELAYS_MS` (optional, test-only
override of the production day-scale backoff schedule) —
`packages/config/src/env.ts`. Exact mirror of `EVENT_BUS_TRANSPORT`/
`SEARCH_PROVIDER`.

**2. Two interchangeable `DunningOrchestrator` implementations** —
`PostgresDunningOrchestrator` (default) and `TemporalDunningOrchestrator` —
selected via a factory provider exactly like `PAYMENT_PROVIDER`'s. Unlike
Postgres/OpenSearch in prior phases (where one implementation is the
pre-existing code, untouched), *neither* dunning backend existed before
this phase — both are new, but they implement the identical business
schedule (3 retries, day-scale backoff, cancel on exhaustion), differing
only in which system tracks the waiting and retrying.

**3. Shared business logic in `DunningActionsService`**
(`apps/api/src/modules/payments/dunning/dunning-actions.service.ts`):
`attemptCharge` (calls the existing, safely-re-invokable
`PaymentsService.startCheckout`) and `cancelSubscription` (calls the
existing `SubscriptionsService.cancel`). Both orchestrators call only these
two methods — one source of truth for "what a dunning attempt/exhaustion
actually does."

**4. Shared retry policy** (`dunning-policy.ts`): `MAX_DUNNING_ATTEMPTS = 3`,
production backoff `[1 day, 3 days, 7 days]`, overridable via
`DUNNING_RETRY_DELAYS_MS` for e2e tests only (a real test cannot wait out
real days). Both orchestrators import this one policy, guaranteeing
identical business behavior regardless of backend.

**5. `DunningListener`** (`@OnEvent("payment.failed")`/
`@OnEvent("payment.succeeded")`, sibling to `AuditListener`/
`SearchIndexListener`) is the one place dunning "starts" — reuses the
existing events, no new publish call sites. **A design correction made
during implementation**: the listener does not read a Postgres table
directly to decide "start a new cycle vs. report an outcome." Instead, each
orchestrator exposes its own `hasActiveCycle(subscriptionId)`, and the
listener always asks *the same orchestrator* it is about to act through.
This was necessary because the first working version had the listener
check a `dunning_cycles` Postgres row regardless of backend, but
`TemporalDunningOrchestrator` never wrote to that table — so under
`WORKFLOW_ENGINE=temporal`, every retry's failure was misread as a *first*
failure, and a second `startDunning` call for an already-running workflow
threw `WorkflowExecutionAlreadyStartedError` (caught live by the e2e test's
second scenario). The fix: `TemporalDunningOrchestrator.hasActiveCycle`
asks the workflow's own execution state (`handle.describe().status.name ===
"RUNNING"`, treating `WorkflowNotFoundError` as "no cycle") rather than
maintaining a shadow bookkeeping table — Temporal's execution state is
already the authoritative answer, so duplicating it in Postgres would only
create a second source of truth to keep in sync.

**6. Graceful degradation.** If the active orchestrator is `temporal` and
either `hasActiveCycle` or the resulting action throws, `DunningListener`
falls back to running the *entire* decision-and-action through
`PostgresDunningOrchestrator` instead — never a mix of one orchestrator's
read with another's write. Dunning can only gain durability from enabling
Temporal, never regress to "silently stops retrying."

**7. `PostgresDunningOrchestrator`**: a new `dunning_cycles` table (`payments`
schema, alongside `payments`) tracks `subscriptionId`, `latestPaymentId`,
`attemptNumber`, `nextAttemptAt`, `status` (`waiting|attempting|succeeded|
exhausted`), with a partial unique index enforcing at most one active cycle
per subscription. A new `DunningScheduler` (`@Cron`, mirrors
`RenewalsScheduler`) polls due rows and fires the next attempt; is a no-op
entirely when `WORKFLOW_ENGINE=temporal` (Temporal drives its own retries).

**8. `TemporalDunningOrchestrator`**: a lazily-constructed `@temporalio/client`
connection (mirrors `RabbitMQAuditTransport`'s lazy-connection idiom) starts
a `dunningWorkflow` with workflow ID `dunning:${subscriptionId}` — natural
idempotency via Temporal's workflow-ID uniqueness. The workflow itself
(`workflows/dunning.workflow.ts`) is intentionally minimal: loop over the
retry delays, `sleep`, call `attemptChargeActivity`, `condition()`-wait
(bounded at 3 days) for a `paymentResolved` signal, stop on success; call
`cancelSubscriptionActivity` if the loop exhausts. All business logic lives
in activities (`workflows/dunning.activities.ts`, thin wrappers around
`DunningActionsService`) — the workflow function itself touches no DB or
service directly, respecting Temporal's determinism/sandboxing constraints.

**9. The Temporal Worker runs in-process**, not as a separate deployment — a
new `TemporalWorkerService` (`OnModuleInit`/`OnModuleDestroy`) starts a
`@temporalio/worker` `Worker` only when `WORKFLOW_ENGINE=temporal`,
registering the workflow bundle and activities built from the
Nest-resolved `DunningActionsService`. Matches this app's modular-monolith
architecture; splitting the worker into its own deployment is exactly the
kind of change the eventual microservices-split phase (last of the five)
would make, not this one. It is also what lets a single Jest e2e process
exercise a genuine start-workflow → execute → signal → complete round trip
against the real server.

**10. `docker-compose.yml`** gains a `temporal` service
(`temporalio/auto-setup:1.24`, pointed at the existing shared `postgres`
container rather than a second stateful service, port shifted to
`7234:7233`) and `temporal-ui` (`temporalio/ui:latest`, port `8081`, for
local inspection — same spirit as RabbitMQ's management image). Two
version-specific quirks were discovered and fixed empirically, the same
"verify against a real container" discipline every prior phase used:
- `DB=postgresql` is rejected by `auto-setup`'s entrypoint (valid drivers
  are `mysql8`, `postgres12`, `postgres12_pgx`, `cassandra` — not
  `postgresql`); fixed by using `DB=postgres12`.
- The server binds/advertises only on the container's own Docker-network
  IP, not loopback — `temporal operator cluster health` against
  `localhost:7233` fails with connection-refused even once the server is
  fully up. The healthcheck resolves the container's own IP first:
  `temporal operator cluster health --address $(hostname -i):7233`.

**11. Testing**: unit tests for `DunningActionsService`, both orchestrators
(`jest.mock("@temporalio/client")` for the Temporal one, mirroring
`jest.mock("amqplib")`), `DunningListener` (locks in the fallback and the
"same orchestrator decides and acts" invariant), and `DunningScheduler`. A
new `test/dunning-temporal.e2e-spec.ts` sets `WORKFLOW_ENGINE=temporal`,
`TEMPORAL_ADDRESS`, and a short `DUNNING_RETRY_DELAYS_MS` override before
importing the shared test bootstrap (the pattern `rabbitmq-audit.e2e-spec.ts`/
`search-opensearch.e2e-spec.ts` established), and drives two real round
trips against the live server + in-process worker: a failed charge that
recovers on retry, and one that exhausts all three retries and cancels the
subscription. **A planned `@temporalio/testing` time-skipping workflow unit
test was attempted and dropped**: the first run passed, but a second
invocation left the ephemeral Java-based test server unreachable
(`ConnectionRefused`, ~240 failed retries) with no crash-loop recovery —
an environment-specific fragility, not a bug in the workflow code itself.
Since the real e2e test already exercises the identical `dunningWorkflow`
logic against a live, persistent server (arguably stronger evidence than a
mocked-activity unit test), the flaky dependency was removed rather than
carried as a source of CI flakiness. The full existing unit (129/129) and
e2e suites were re-run under the default `WORKFLOW_ENGINE=in-process` and
stayed green with zero regressions.

**12. Not built this phase**: migrating the renewal-reminder cron itself
onto Temporal (ADR 0007's reasoning still holds — nothing changed about
that job's single-step shape); a UI for dunning cycles beyond Temporal's
own bundled Web UI; configurable per-plan retry policies; using Temporal
for anything beyond dunning. Each is a reasonable, separable future
increment, recorded here rather than silently gapped.

## Consequences

- A real, opt-in Temporal-backed dunning workflow now exists
  (`WORKFLOW_ENGINE=temporal`), closing the previously-real gap where a
  failed renewal charge produced one email and then silence — but the
  Postgres/cron backend remains the default, since it implements the exact
  same business schedule without a new infrastructure dependency.
- The "listener asks the orchestrator, not a shared table" correction is a
  design principle that generalizes: any future dunning-adjacent feature
  should keep decision-making inside the active orchestrator rather than
  re-deriving state from a table only one backend maintains.
- Temporal is now running in the local/dev topology (`docker-compose.yml`)
  as a real prerequisite building block, alongside RabbitMQ, for the
  eventual microservices split (ADR 0001's "Consequences" section).
- Keycloak and the microservices split remain the last two of the five
  originally-deferred items.
