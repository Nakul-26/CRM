# ADR 0012: Audit Log Real-Time Streaming Phase 12 scope — SSE over the existing event bus

## Status

Accepted — 2026-08-21

## Context

ADR 0010 point 7 explicitly deferred "real-time streaming of new audit
rows" when the audit log UI shipped (Phase 10). ADR 0011 (Phase 11, CSV
export) recorded it as still open. The user picked it as the next item
from the original deferred list (payment processing, real-time streaming,
RabbitMQ/Keycloak/Temporal/OpenSearch, microservices split), after CSV
export. Scope here is exactly that: new audit rows appear on the dashboard
live, without a manual refresh — nothing about notifications, which ADR
0009 point 7 separately and deliberately kept polling-only ("no new
transport infrastructure... unless a concrete need forces it"). This phase
is that concrete need, but only for the audit log; it does not
retroactively revisit the notifications decision.

There was no WebSocket/SSE infrastructure anywhere in the app before this
phase — confirmed by a full-repo sweep. This is the first real-time push
transport the app has.

## Decisions

**1. Server-Sent Events (SSE), not WebSocket.** NestJS's built-in `@Sse()`
decorator (`Observable<MessageEvent>`), using RxJS and `@nestjs/event-
emitter`'s `EventEmitter2` — both already dependencies, no new package.
Audit-log streaming is one-directional (server → client only); SSE is the
minimal transport for that, plain HTTP, auto-reconnecting natively in the
browser. A WebSocket would need `@nestjs/websockets` + `socket.io`/`ws`,
new dependencies, for bidirectionality this feature doesn't need.

**2. Powered by the existing in-process `EventEmitter2`**, the same bus
`DomainEventBus`/`AuditListener` already use
(`apps/api/src/shared/events/domain-event-bus.ts`,
`apps/api/src/shared/audit/audit.listener.ts`). `AuditListener` emits a
new, dedicated event (`audit.log.entry.created`) right after its DB insert
succeeds; the SSE route (`GET /audit-log/stream` on `AuditController`)
subscribes to that event via `fromEvent`. Documented limitation: in-process
`EventEmitter2` doesn't fan out across multiple API instances — a real gap
only if the API is ever horizontally scaled, which it isn't today (ADR
0001, single-deployable modular monolith). That's the concrete trigger for
Redis pub/sub or RabbitMQ later, not a reason to add it now.

**3. Signal-only payload on the wire** —
`{ organizationId, eventType, actorId, createdAt }` (enough to filter, not
the full row) — not the full `AuditLogEntryDto`. Only `eventType` reaches
the client; the client reacts by refetching the existing, already-correct
`useAuditLog` list query, not by splicing the pushed payload directly into
UI state. Avoids a second, parallel place that shapes audit rows (joins for
`actorName`/`actorEmail`, JSON payload, etc.) alongside
`AuditService.list()` — one read path stays authoritative.

**4. Filter-matching pulled into a pure, unit-tested function** —
`matchesAuditStreamFilters(event, filters)` in
`apps/api/src/modules/identity/audit/audit-stream.ts`, tested in
`audit-stream.spec.ts` with no DB/HTTP/SSE involved. Mirrors Phase 11's
`audit-export.ts` precedent ("pure builder pulled out, unit-tested
standalone").

**5. Live updates only apply on the newest page (`offset === 0`).** The
stream connects (and the "new entries" banner can appear) only when the
dashboard is showing page 1; paging away closes it
(`apps/web/src/hooks/use-audit-log-stream.ts`'s `enabled` flag, driven by
the page). Sidesteps pagination-splice correctness entirely — a pushed row
has no well-defined place in an already-paginated, filtered view beyond
"the newest page."

**6. Banner-driven manual refresh, not silent auto-splice.** On a matching
stream event, the page shows a small "New audit events — Refresh"
affordance; clicking it refetches via the existing `useAuditLog` query
(same one the Prev/Next pager already uses) and dismisses the banner. No
risk of a live-pushed row silently reordering what the user is looking at
mid-read.

**7. BFF gateway (`apps/web/src/app/api/gateway/[...path]/route.ts`) gets a
new streaming branch** for `text/event-stream` responses — pipes
`apiRes.body` straight through via `NextResponse`, instead of the existing
buffered `.text()`/`.arrayBuffer()` path. The browser's native
`EventSource` can't set an `Authorization` header, so it must hit the
same-origin, cookie-authenticated gateway (same as every other request) —
but the gateway's `proxy()` fully buffers the upstream response first,
which would hang forever against a stream that never ends. This is the one
change required to the gateway; the "browser only ever talks to
`/api/gateway/*`" invariant stays intact.

**8. A 15s heartbeat event** (named `heartbeat`, ignored by the client)
merged into the same Observable, so intermediary idle-connection timeouts
don't silently kill the stream. No custom reconnect logic — `EventSource`
reconnects natively on drop; no missed-event replay/`Last-Event-ID`
resumability. A missed signal during a reconnect gap just means the banner
shows up on the next matching event instead — self-healing, no data loss
(the row is still in the DB, visible on next fetch/page load).

**9. No new permission.** `@Sse("stream")` reuses `audit.log.view`, same as
`list`/`export`.

**10. Not built:** WebSocket, live-push for any other list or for
notifications, guaranteed delivery/replay, cross-instance fan-out,
splicing pushed rows directly into the table without a refetch. Scoped to
exactly what ADR 0010 deferred for the audit log.

## Consequences

- The audit dashboard now surfaces new activity live (while viewing the
  newest page), instead of requiring a manual reload or Prev/Next
  round-trip to see rows written after the page loaded.
- The app gained its first real-time push transport (SSE) and its first
  BFF-gateway streaming branch — a reusable precedent if another endpoint
  ever needs live push, though nothing else does yet.
- The e2e suite gained its first raw-`http`-stream test helper
  (`apps/api/test/audit-log.e2e-spec.ts`), since `supertest` doesn't handle
  open-ended responses — a template for testing future SSE endpoints, if
  any are added.
- The runner-up "real-time streaming" deferral from ADR 0010 is now
  resolved for the audit log specifically; payload search and retention
  policy remain open deferrals there. Notifications' polling stance (ADR
  0009 point 7) is untouched.
