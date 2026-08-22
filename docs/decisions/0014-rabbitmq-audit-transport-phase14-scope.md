# ADR 0014: RabbitMQ Phase 14 scope — a durable transport for the audit pipeline only

## Status

Accepted — 2026-08-22

## Context

[ADR 0001](0001-modular-monolith.md) deferred RabbitMQ from day one: "the
in-process event bus is API-compatible in shape; a later swap publishes the
same envelopes onto a broker instead of an `EventEmitter`." The user asked
to work through the five originally-deferred items (RabbitMQ, Keycloak,
Temporal, OpenSearch, microservices split) one at a time, starting with
RabbitMQ — the lowest-risk and most self-contained of the five, and (per
ADR 0001's own "Consequences" section) a natural prerequisite for the
eventual microservices split, which is sequenced last as a result.

**The concrete need driving scope**: `AuditListener`
(`apps/api/src/shared/audit/audit.listener.ts`) writes every domain event to
the `audit_log` table from a synchronous, in-process
`@OnEvent("domain.event")` handler wrapped in try/catch — if that DB insert
throws, the audit row was, until this phase, silently lost forever (caught
and logged, never retried). For a CRM whose audit trail is a compliance
surface, that is a real gap. RabbitMQ with a durable queue, manual ack/nack,
and a dead-letter queue closes it: a failed write becomes a
retryable/inspectable DLQ message instead of nothing.

## Decisions

**1. Only the audit pipeline moves onto RabbitMQ this phase.** The other
three domain-event listeners (`MailListener`, `NotificationsListener`,
`QuoteAcceptedListener`) stay on the in-process `EventEmitter2` dispatch,
completely untouched. `DomainEventBus.publish()` itself is not modified — it
still emits locally exactly as before, for every one of its ~56 existing
call sites and every listener. Mirrors the Payments-phase discipline: build
a general-shaped capability, wire up one concrete, well-motivated use case,
document the rest as deferred. Audit is the one listener where "a duplicate
write is fine, a dropped one is not" makes broker durability worth its
complexity — Mail/Notifications/QuoteAccepted are explicitly best-effort by
design and gain nothing from it.

**2. New `EVENT_BUS_TRANSPORT=in-process|rabbitmq` env var** (default
`in-process`), plus `RABBITMQ_URL` (optional, only read when
`EVENT_BUS_TRANSPORT=rabbitmq`) — `packages/config/src/env.ts`. Every
existing e2e test keeps running exactly as before, with zero RabbitMQ
dependency by default. Same shape as `PAYMENT_PROVIDER=mock|stripe`
(ADR 0013).

**3. The integration point is inside `AuditListener`, not `DomainEventBus`.**
When the transport is `rabbitmq`, `AuditListener.handleDomainEvent` first
tries a confirm-channel publish onto a durable topic exchange
(`domain.events`, routing key = the event's `eventType`); if the broker
confirms receipt, it returns — a queue consumer, started from the same
`AuditListener.onModuleInit()` (avoiding a circular DI dependency between
the listener and the transport), performs the actual DB write. If the
broker publish isn't confirmed for any reason (broker down, timeout,
connection error), it falls straight through to the pre-existing direct
write as a safety net. This keeps the blast radius to one file
(`audit.listener.ts`) plus one new transport class
(`rabbitmq-audit-transport.ts`) — `DomainEventBus`'s public API is untouched
(still fully synchronous), as are the other three listeners. The fallback
means switching this transport on can only ever *add* a durability path,
never regress to dropping more often than before.

**4. Topology**: one durable topic exchange `domain.events` (routing key =
the existing dot-delimited `eventType` strings, reused directly — no new
naming scheme), one durable queue `audit.log.consumer` bound with routing
key `#` (mirrors the existing local wildcard `"domain.event"` catch-all
subscription), dead-lettered via `x-dead-letter-exchange` to a fanout
exchange (`domain.events.dlx`) feeding `audit.log.consumer.dlq` on nack.
Prefetch 1. This is the minimal real topology that gets genuine
at-least-once durable delivery plus a DLQ for poison messages, without
building retry-count/backoff logic — a stuck message needs manual DLQ
inspection for now, a documented cut rather than a silent gap.

**5. `amqplib` used directly**, no `@golevelup/nestjs-rabbitmq` wrapper —
matches house style (`stripe`, `postgres`/`drizzle-orm` are both used as
plain client libraries, not framework-specific wrappers).

**6. Lazy connection.** `RabbitMQAuditTransport` builds its AMQP connection
on first use (a cached getter), not in a constructor or an unconditional
`onModuleInit` — the exact mirror of `StripePaymentProvider`'s
`getClient()`/`getWebhookClient()` idiom from ADR 0013. `EVENT_BUS_TRANSPORT
=in-process` (default) never requires `RABBITMQ_URL` to be set or a broker
to be reachable, including at app boot.

**7. `docker-compose.yml`** gains a `rabbitmq` service
(`rabbitmq:3-management-alpine` — the management image is needed for the
HTTP API the e2e test polls, the same idiom `test/setup/mailpit.ts` already
uses for Mailpit), ports shifted to `5673`/`15673` like the other two
shifted services, with a healthcheck.

**8. Testing**: `rabbitmq-audit-transport.spec.ts` (`jest.mock("amqplib")`,
mirroring `jest.mock("stripe")`) unit-tests the confirm/nack/timeout paths
and the consumer's ack/nack behavior. `audit.listener.spec.ts` locks in the
fallback-to-direct-write behavior when the broker doesn't confirm — the same
regression-locking spirit as ADR 0013's "no STRIPE_SECRET_KEY" test. A new
`test/rabbitmq-audit.e2e-spec.ts` sets `EVENT_BUS_TRANSPORT=rabbitmq` before
importing the shared test bootstrap and drives a real broker round-trip
against the actual `rabbitmq` container, polling `GET /audit-log` the same
way `waitForMessage` already polls Mailpit — proving genuine delivery, not
just that the publish call didn't throw. The full existing unit + e2e
suites were re-run under the default `EVENT_BUS_TRANSPORT=in-process` and
stayed green with zero regressions or timing changes, since that code path
is unmodified.

**9. Not built this phase**: migrating Mail/Notifications/QuoteAccepted onto
the broker; retry-count/backoff on the DLQ path; a management UI/dashboard
beyond RabbitMQ's own (exposed via the `-management` image); multi-instance
consumer load testing; exactly-once dedup (an audit row duplicated by an
at-least-once redelivery is an accepted, harmless outcome — strictly better
than the prior silent-drop). Each is a reasonable, separable future
increment given a concrete need, recorded here rather than silently gapped.

## Consequences

- The audit trail's one previously-silent failure mode (a DB insert
  throwing inside the try/catch) is closed when `EVENT_BUS_TRANSPORT=
  rabbitmq` is enabled — a failed write now lands in an inspectable DLQ
  instead of vanishing.
- The app gained its first real message-broker integration, opt-in and
  fully inert by default, following the exact "pluggable provider, safe
  default" shape ADR 0013 established for Stripe.
- Because the consumer is a normal competing-consumer subscription rather
  than anything process-specific, a future horizontally-scaled deployment
  gets audit-write load-balancing across instances for free, with no further
  code changes — a side benefit, not something tested this phase.
- Mail, Notifications, and QuoteAccepted remain in-process/best-effort;
  migrating any of them is an open deferral for whenever a concrete need
  (not just "for consistency") shows up.
- RabbitMQ is now running in the local/dev topology
  (`docker-compose.yml`) and is a real prerequisite building block for the
  eventual microservices split (ADR 0001's "Consequences" section), which
  remains the last of the five deferred items to be picked up.
