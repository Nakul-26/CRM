# Phase 14 — RabbitMQ (durable audit-event transport)

## Context

[ADR 0001](../decisions/0001-modular-monolith.md) deferred RabbitMQ from day one: "the in-process event bus is API-compatible in shape; a later swap publishes the same envelopes onto a broker instead of an `EventEmitter`." The user has now asked to work through the five originally-deferred items (RabbitMQ, Keycloak, Temporal, OpenSearch, microservices split) one at a time. RabbitMQ goes first — it's the lowest-risk, most self-contained of the five, and (per ADR 0001's own "Consequences" section) is a natural prerequisite for the eventual microservices split, which should therefore come last.

**The concrete need driving scope**: today, `AuditListener` (`apps/api/src/shared/audit/audit.listener.ts`) writes every domain event to the `audit_log` table from a synchronous, in-process `@OnEvent("domain.event")` handler wrapped in try/catch — *if that DB insert throws, the audit row is silently lost forever* (caught and logged, never retried). For a CRM whose audit trail is a compliance surface, that's a real gap. RabbitMQ with a durable queue, manual ack/nack, and a dead-letter queue closes it: a failed write becomes a retryable/inspectable DLQ message instead of nothing.

## Scope decisions

| Decision | Reasoning |
|---|---|
| **Only the audit pipeline moves onto RabbitMQ this phase.** The other three listeners (`MailListener`, `NotificationsListener`, `QuoteAcceptedListener`) stay on the in-process `EventEmitter2` dispatch, completely untouched. `DomainEventBus.publish()` itself is **not modified** — it keeps emitting locally exactly as today, for every publisher and every listener. | Mirrors the Payments-phase discipline: build a general-shaped capability, wire up one concrete, well-motivated use case, document the rest as deferred (no concrete need yet — same standard ADR 0001 itself uses). Audit is the only listener where "duplicate is fine, dropped is not" makes broker durability worth its complexity; Mail/Notifications/QuoteAccepted are explicitly best-effort by design and gain nothing from it. |
| **New `EVENT_BUS_TRANSPORT=in-process\|rabbitmq` env var, default `in-process`.** All existing e2e tests keep running exactly as today, no behavior change, no RabbitMQ dependency at all by default. | Same shape as `PAYMENT_PROVIDER=mock\|stripe`. Zero regression risk to the 145+ passing e2e tests. |
| **Integration point is inside `AuditListener`, not `DomainEventBus`.** When transport is `rabbitmq`, `AuditListener.handleDomainEvent` first tries a confirm-channel publish onto a durable topic exchange; if the broker confirms receipt, it returns (a queue consumer — started from the same `AuditListener`, avoiding a circular DI dependency — performs the actual DB write). If the broker publish isn't confirmed (broker down, timeout, anything), it falls straight through to today's direct write as a safety net. | Keeps the blast radius to one file + one new transport class. No change to `DomainEventBus`'s public API (still fully synchronous, all 56 existing `.publish()` call sites untouched) or to the other three listeners. The fallback means switching on `rabbitmq` mode can only ever *add* a durability path, never regress to "silently drop more often" than today. |
| **Topology**: one durable topic exchange `domain.events` (routing key = `eventType`, e.g. `payment.succeeded` — reuses the existing dot-delimited event-type strings directly), one durable queue `audit.log.consumer` bound with routing key `#` (mirrors today's local wildcard `"domain.event"` catch-all), dead-lettered (`x-dead-letter-exchange`) to `audit.log.consumer.dlq` on nack. Prefetch 1. | Minimal real topology that gets genuine at-least-once durable delivery + a DLQ for poison messages, without building retry-count/backoff logic this phase (documented cut — a stuck message needs manual DLQ inspection, not automatic retry, for now). |
| **`amqplib` used directly** (no `@golevelup/nestjs-rabbitmq` wrapper). | Matches house style: `stripe` and `postgres`/`drizzle-orm` are both used as plain client libraries, not framework-specific wrappers. |
| **Lazy connection**, built on first use inside the transport class (getter pattern), not in a constructor or `onModuleInit` unconditionally. | Exact mirror of `StripePaymentProvider`'s `getClient()`/`getWebhookClient()` idiom — `EVENT_BUS_TRANSPORT=in-process` (default) must never require `RABBITMQ_URL` to be set or a broker to be reachable, including at app boot. |
| **Not built this phase**: migrating Mail/Notifications/QuoteAccepted onto the broker; retry-count/backoff on the DLQ path; a management UI/dashboard beyond RabbitMQ's own (exposed via the `-management` image); multi-instance consumer load testing; exactly-once dedup (an audit row duplicated by an at-least-once redelivery is an accepted, harmless outcome — strictly better than today's silent-drop). | Each is a reasonable, separable future increment given a concrete need, recorded here rather than silently gapped — same discipline as every prior phase's "Not built" row. |

## Backend

### `docker-compose.yml` (existing, root)
Add a `rabbitmq` service: `rabbitmq:3-management-alpine` (management image, needed for the HTTP API the e2e test polls — same idiom `test/setup/mailpit.ts` already uses for Mailpit). Ports shifted like the other two shifted services: `5673:5672` (AMQP), `15673:15672` (management UI), inline comment explaining the shift. Healthcheck `rabbitmq-diagnostics -q ping` (mirrors `pg_isready`/`redis-cli ping`). Named volume `rabbitmq_data`.

### Env — `packages/config/src/env.ts`
```ts
EVENT_BUS_TRANSPORT: z.enum(["in-process", "rabbitmq"]).default("in-process"),
RABBITMQ_URL: z.string().optional(),
```
`apps/api/.env.example`: add both, commented that `RABBITMQ_URL` is only needed when `EVENT_BUS_TRANSPORT=rabbitmq`.

### `apps/api/package.json`
Add `amqplib` (dependency) + `@types/amqplib` (devDependency).

### `apps/api/src/shared/audit/rabbitmq-audit-transport.ts` (new)
Pure plumbing, no audit-domain knowledge:
- Lazy `getChannel()`: connects via `amqplib.connect(RABBITMQ_URL)`, creates a **confirm channel** (`connection.createConfirmChannel()`), asserts the exchange/queue/DLQ topology described above, caches the channel/connection for reuse. Throws a clear error only when actually invoked without `RABBITMQ_URL` set (never at module init).
- `async publishForAudit(event: DomainEvent): Promise<boolean>` — publishes `event` (JSON, `persistent: true`) to `domain.events` with routing key `event.eventType`, awaits broker confirm, returns `true` on ack, `false` on any nack/error/timeout (catches everything — never throws, matches the "must never break the business operation" ethos already used by `MailListener`/`NotificationsListener`).
- `startConsuming(onMessage: (event: DomainEvent) => Promise<void>)` — begins consuming `audit.log.consumer` (prefetch 1); on message, calls `onMessage`, `ack`s on success, `nack(msg, false, false)` (→ DLQ) on throw.
- `OnModuleDestroy` — closes channel/connection cleanly.

### `apps/api/src/shared/audit/audit.listener.ts` (existing, modified)
- Extract the existing insert-plus-SSE-emit logic into `writeAuditEntry(event: DomainEvent): Promise<void>` (behavior unchanged, just named/reusable).
- `handleDomainEvent` (`@OnEvent("domain.event")`):
  ```ts
  async handleDomainEvent(event: DomainEvent) {
    if (this.config.get("EVENT_BUS_TRANSPORT", { infer: true }) === "rabbitmq") {
      const confirmed = await this.rabbit.publishForAudit(event);
      if (confirmed) return; // the queue consumer will write it
    }
    await this.writeAuditEntry(event);
  }
  ```
- `onModuleInit()` (new): if transport is `rabbitmq`, `this.rabbit.startConsuming((event) => this.writeAuditEntry(event))`.
- Under the default `in-process` transport this is byte-identical to today's behavior — the `if` branch is simply never entered.

### `apps/api/src/shared/shared.module.ts` (existing)
Add `RabbitMQAuditTransport` to `providers` (sibling of `AuditListener`, injected directly — no new DI token/factory needed since only one class consumes it).

## Testing

- **Unit** (`rabbitmq-audit-transport.spec.ts`, `jest.mock("amqplib")` — mirrors `jest.mock("stripe")`): confirm-channel publish resolves true/false correctly; consumer ack-on-success / nack-on-failure.
- **Unit** (`audit.listener.spec.ts`, extend existing or new): with transport mocked to return `confirmed = false`, assert `writeAuditEntry` (direct DB path) still runs — the regression-locking test for the fallback safety net, same spirit as Phase 13's "no STRIPE_SECRET_KEY" test.
- **New e2e** (`apps/api/test/rabbitmq-audit.e2e-spec.ts`): sets `process.env.EVENT_BUS_TRANSPORT = "rabbitmq"` and `RABBITMQ_URL` at the top of the file, before importing `./setup/test-app` (mirrors that file's own "env set before any module import" idiom) — a self-contained spec, not the shared default. Trigger a real action (e.g. create an Account), then **poll** `GET /audit-log` until the row appears (bounded timeout — same polling idiom as `test/setup/mailpit.ts`'s `waitForMessage`), proving genuine broker round-trip delivery, not just "the publish call didn't throw."
- **Regression check**: full existing unit + e2e suites re-run under the default `EVENT_BUS_TRANSPORT=in-process` — must stay green with zero timing changes, since that code path is unmodified.
- `packages/config/src/env.ts` in `test-app.ts` needs `process.env.EVENT_BUS_TRANSPORT ??= "in-process"` (`??=` so the new spec's explicit override wins, everything else defaults).

## Docs

- `docs/decisions/0014-rabbitmq-audit-transport-phase14-scope.md` — codifies the table above, references ADR 0001's deferral.
- `docs/plans/0014-phase14-rabbitmq-plan.md` — this plan, persisted.
- `docs/architecture/overview.md` — phase-link entry + "Phase 14 scope" section.
- `README.md` — Phase 14 marked current (Phase 13 loses "(current)"); the "Why not [RabbitMQ / Keycloak / ...]?" line drops RabbitMQ from the bracket and gets a short note that it's now available for the audit pipeline behind `EVENT_BUS_TRANSPORT=rabbitmq` (default stays in-process).

## Verification

1. `docker compose up -d rabbitmq` (alongside existing postgres/redis/mailpit) — confirm healthy.
2. Unit tests green (`rabbitmq-audit-transport.spec.ts`, `audit.listener.spec.ts`).
3. New `rabbitmq-audit.e2e-spec.ts` green against the real container.
4. Full existing unit + e2e suites green under default `EVENT_BUS_TRANSPORT=in-process` (no regression).
5. `pnpm --filter @sales-platform/api build` clean (no frontend changes this phase).

### Critical files
- `apps/api/src/shared/audit/rabbitmq-audit-transport.ts` (new)
- `apps/api/src/shared/audit/audit.listener.ts` (existing) — fallback-safe integration point
- `apps/api/src/shared/shared.module.ts` (existing) — register the new provider
- `packages/config/src/env.ts` (existing) — `EVENT_BUS_TRANSPORT`, `RABBITMQ_URL`
- `docker-compose.yml` (existing) — new `rabbitmq` service
- `apps/api/test/rabbitmq-audit.e2e-spec.ts` (new)
- `apps/api/test/setup/test-app.ts` (existing) — `EVENT_BUS_TRANSPORT ??= "in-process"` default

---

## After Phase 14: remaining deferred items

Continuing in this order (each gets its own ADR/plan/implementation/verification cycle before moving to the next, same as every phase so far):

1. **RabbitMQ** — this plan.
2. **OpenSearch** — swap/augment Postgres `tsvector` global search once volume/relevance actually warrants it; independent of the others.
3. **Temporal** — durable workflow orchestration (e.g. subscription renewal retries/dunning) replacing the current Postgres-backed scheduled-job approach where it's actually needed.
4. **Keycloak** — swap the first-party JWT/refresh-token auth module for Keycloak/OIDC federation; the most invasive of the five (touches every module's auth), so it's sequenced after the lower-risk infra additions.
5. **Microservices split** — extracting one or more modules into separately deployable services now that a real broker (RabbitMQ) and, optionally, shared external identity (Keycloak) exist to support it — the natural last step per ADR 0001's own "Consequences" section.
