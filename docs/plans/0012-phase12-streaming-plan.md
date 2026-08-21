# Phase 12 — Audit Log Real-Time Streaming (SSE)

## Context

ADR 0010 point 7 explicitly deferred "real-time streaming of new audit
rows" when the audit log UI shipped (Phase 10); ADR 0011 (Phase 11, CSV
export) recorded it as still open. The user picked it as the next item
from the original deferred list (payment processing, real-time streaming,
RabbitMQ/Keycloak/Temporal/OpenSearch, microservices split), after CSV
export. Scope is exactly that: new audit rows should appear on the
dashboard live, without a manual refresh — nothing about notifications,
which ADR 0009 point 7 separately and deliberately kept polling-only
("no new transport infrastructure... unless a concrete need forces it").
This phase is that concrete need, but only for the audit log; it does not
retroactively revisit the notifications decision.

Today there is **no WebSocket/SSE infrastructure anywhere in the app** —
confirmed by a full-repo sweep (no `EventSource`, `@Sse`, `socket.io`,
`ws`, or `@nestjs/websockets` anywhere in `apps/api` or `apps/web`). This
is the first real-time push transport the app gets.

## 0. Scope decisions

| Decision | Reasoning |
|---|---|
| **Server-Sent Events (SSE), not WebSocket.** NestJS's built-in `@Sse()` decorator (`Observable<MessageEvent>`), using RxJS and `@nestjs/event-emitter`'s `EventEmitter2` — both already dependencies, no new package. | Audit-log streaming is one-directional (server → client only); SSE is the minimal transport for that, plain HTTP, auto-reconnecting natively in the browser. A WebSocket would need `@nestjs/websockets` + `socket.io`/`ws`, new dependencies, for bidirectionality this feature doesn't need. |
| **Powered by the existing in-process `EventEmitter2`**, the same bus `DomainEventBus`/`AuditListener` already use (`apps/api/src/shared/events/domain-event-bus.ts`, `apps/api/src/shared/audit/audit.listener.ts`). `AuditListener` emits a new, dedicated event right after its DB insert succeeds; the SSE route subscribes to that event via `fromEvent`. | Reuses wiring that's already there instead of adding a second notification path. Documented limitation: in-process `EventEmitter2` doesn't fan out across multiple API instances — a real gap only if the API is ever horizontally scaled, which it isn't today (ADR 0001, single-deployable modular monolith). That's the concrete trigger for Redis pub/sub or RabbitMQ later, not a reason to add it now. |
| **Signal-only payload on the wire** — `{ eventType, actorId, createdAt }` (enough to filter, not the full row) — not the full `AuditLogEntryDto`. The client reacts by refetching the existing, already-correct `useAuditLog` list query, not by splicing the pushed payload directly into UI state. | Avoids a second, parallel place that shapes audit rows (joins for `actorName`/`actorEmail`, JSON payload, etc.) alongside `AuditService.list()` — one read path stays authoritative. Matches Phase 11's own reasoning for keeping `audit-export.ts` a thin layer over the same `list()` call. |
| **Filter-matching pulled into a pure, unit-tested function** — `matchesAuditStreamFilters(event, filters)` in a new `apps/api/src/modules/identity/audit/audit-stream.ts`, tested in `audit-stream.spec.ts` with no DB/HTTP/SSE involved. | Mirrors Phase 11's `audit-export.ts` precedent ("pure builder pulled out, unit-tested standalone") — same shape of problem: boundary/matching logic that's fast and deterministic to test directly, verbose and slow to exercise only through a live stream. |
| **Live updates only apply on the newest page (`offset === 0`).** The stream connects (and the "new entries" banner can appear) only when the dashboard is showing page 1; paging away closes it. | Sidesteps pagination-splice correctness entirely — a pushed row has no well-defined place in an already-paginated, filtered view beyond "the newest page." No new state-reconciliation logic needed. |
| **Banner-driven manual refresh, not silent auto-splice.** On a matching stream event, the page shows a small "New audit events — Refresh" affordance; clicking it refetches via the existing `useAuditLog` query (same one the Prev/Next pager already uses) and dismisses the banner. | Simplest correct behavior: no risk of a live-pushed row silently reordering what the user is looking at mid-read, no new list-merging code. Same "don't build a second shaping path" reasoning as the signal-only payload above. |
| **BFF gateway (`apps/web/src/app/api/gateway/[...path]/route.ts`) gets a new streaming branch** for `text/event-stream` responses — pipes `apiRes.body` straight through via `NextResponse`, instead of the existing buffered `.text()`/`.arrayBuffer()` path. | The browser's native `EventSource` can't set an `Authorization` header, so it must hit the same-origin, cookie-authenticated gateway (same as every other request) — but the gateway's current `proxy()` fully buffers the upstream response first, which would simply hang forever against a stream that never ends. This is the one change required to the gateway; the "browser only ever talks to `/api/gateway/*`" invariant stays intact rather than adding a parallel route. |
| **A 15s heartbeat event** (named `heartbeat`, ignored by the client) merged into the same Observable, so intermediary idle-connection timeouts don't silently kill the stream. No custom reconnect logic — `EventSource` reconnects natively on drop; no missed-event replay/`Last-Event-ID` resumability. | Matches the app's existing "no delivery guarantee" posture for live-ish data (notifications' polling has the same gap-tolerance). A missed signal during a reconnect gap just means the banner shows up on the next matching event instead — self-healing, no data loss (the row is still in the DB, visible on next fetch/page load). |
| **No new permission.** `@Sse("stream")` reuses `audit.log.view`, same as `list`/`export`. | Matches the established precedent (list, export) of reusing the resource's `.view` permission rather than inventing a stream-specific one. |
| **Not built:** WebSocket, live-push for any other list or for notifications, guaranteed delivery/replay, cross-instance fan-out, splicing pushed rows directly into the table without a refetch. | Scoped to exactly what ADR 0010 deferred for the audit log. Extending real-time push elsewhere is new, unevidenced scope. |

---

## 1. Backend

**`apps/api/src/modules/identity/audit/audit-stream.ts` (new)**
```ts
export const AUDIT_LOG_ENTRY_CREATED_EVENT = "audit.log.entry.created";

export interface AuditStreamEvent {
  organizationId: string;
  eventType: string;
  actorId: string | null;
  createdAt: string; // ISO, set at emit time — a few ms after the DB default, fine for filtering
}

export interface AuditStreamFilters {
  eventType?: string;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function matchesAuditStreamFilters(event: AuditStreamEvent, filters: AuditStreamFilters): boolean { ... }
```
`matchesAuditStreamFilters`: exact match on `eventType`/`actorId` when the
filter is set, range check on `createdAt` against `dateFrom`/`dateTo` when
set — same filter semantics as `AuditService.list()`, just applied to the
lightweight event instead of a DB query.

**`apps/api/src/modules/identity/audit/audit-stream.spec.ts` (new)** — unit
tests: no filters (always matches), `eventType` match/mismatch, `actorId`
match/mismatch, `createdAt` inside/outside a `dateFrom`/`dateTo` range,
combined filters.

**`apps/api/src/shared/audit/audit.listener.ts` (modified)** — inject
`EventEmitter2` (already a global provider via `EventEmitterModule.forRoot`
in `app.module.ts`, no module wiring needed). After the `db.insert(auditLog)`
succeeds, emit:
```ts
this.emitter.emit(AUDIT_LOG_ENTRY_CREATED_EVENT, {
  organizationId: event.organizationId,
  eventType: event.eventType,
  actorId: event.actorId ?? null,
  createdAt: new Date().toISOString(),
} satisfies AuditStreamEvent);
```
Only on success — if the insert throws, nothing is emitted (matches the
existing "audit logging must never break the caller, but also shouldn't
claim success it didn't have" posture already in this file).

**`apps/api/src/modules/identity/audit/audit.controller.ts` (modified)** —
inject `EventEmitter2` alongside `AuditService`. New route:
```ts
@Sse("stream")
@RequirePermissions("audit.log.view")
stream(
  @CurrentUser() user: AuthenticatedUser,
  @Query("eventType") eventType?: string,
  @Query("actorId") actorId?: string,
  @Query("dateFrom") dateFrom?: string,
  @Query("dateTo") dateTo?: string,
): Observable<MessageEvent> {
  const filters: AuditStreamFilters = { eventType, actorId, dateFrom, dateTo };

  const entries$ = fromEvent<AuditStreamEvent>(this.emitter, AUDIT_LOG_ENTRY_CREATED_EVENT).pipe(
    filter((e) => e.organizationId === user.organizationId && matchesAuditStreamFilters(e, filters)),
    map((e) => ({ type: "entry", data: { eventType: e.eventType } })),
  );
  const heartbeat$ = interval(15_000).pipe(map(() => ({ type: "heartbeat", data: {} })));

  return merge(entries$, heartbeat$);
}
```
Confirmed safe: `JwtAuthGuard`/`PermissionsGuard` only read the request and
throw-or-return-boolean — nothing about them assumes a JSON response, so
they gate an `@Sse()` route exactly like any other (`apps/api/src/shared/guards/jwt-auth.guard.ts`,
`permissions.guard.ts`). No global interceptor exists in `main.ts`/`app.module.ts`
that could try to serialize the stream. No `:id`-style route on this
controller to conflict with the new literal `stream` segment.

**Route table (new only):**

| Method | Path | Auth |
|---|---|---|
| GET (SSE) | `/audit-log/stream` | `audit.log.view` |

---

## 2. BFF gateway

`apps/web/src/app/api/gateway/[...path]/route.ts` — in `proxy()`, after the
upstream `fetch` resolves and `contentType` is read, add a branch before
the existing buffering logic:
```ts
if (contentType.startsWith("text/event-stream")) {
  return new NextResponse(apiRes.body, {
    status: apiRes.status,
    headers: { "content-type": contentType, "cache-control": "no-cache", connection: "keep-alive" },
  });
}
```
Everything else (JSON, CSV, PDF) keeps using the existing buffered path
unchanged.

---

## 3. e2e testing

Extend `apps/api/test/audit-log.e2e-spec.ts` with a new `describe("SSE
stream")` block. Supertest can assert the permission-gate responses
normally (guards reject before the Observable is ever subscribed, so those
stay ordinary buffered 401/403 responses), but consuming an open-ended SSE
body needs a small raw-`http` helper since nothing like it exists yet in
this suite:
- Ensure the test server is actually listening (`createTestApp()` calls
  `app.init()` but never `.listen()`) — bind it once via
  `app.getHttpServer().listen(0)` if not already listening, read the bound
  port off `.address()`.
- A helper that opens a raw `http.get` with the `Authorization` header,
  accumulates response chunks via `res.on("data", ...)`, resolves once the
  buffered text satisfies a predicate or a timeout elapses, and always
  `req.destroy()`s the connection afterward (it never closes on its own) —
  critical to avoid leaving open handles that hang Jest.
- Tests: (1) connecting with no filters, then triggering `createAccount()`
  (existing helper) via a normal `supertest` call, observes an `event:
  entry` frame mentioning `account.created` within a few seconds; (2) with
  `?eventType=opportunity.won` set, triggering both an unrelated event and
  a matching one, observes only the matching one; (3) permission gate — 403
  without `audit.log.view`, 401 unauthenticated, both via ordinary
  `supertest` (no raw stream needed, since guards reject before streaming
  starts).

This is the most novel piece of testing infrastructure in this phase —
worth double-checking after writing that the suite doesn't hang or leave
dangling handles (`--detectOpenHandles` if anything looks off).

Re-run the full e2e suite after, to confirm no regressions.

---

## 4. Frontend

**`apps/web/src/hooks/use-audit-log-stream.ts` (new)** — takes the current
filters (`eventType`/`actorId`/`dateFrom`/`dateTo`) and an `enabled` flag
(the page passes `offset === 0`). When enabled, opens `new EventSource(
"/api/gateway/audit-log/stream?" + params)`, adds a listener for the named
`entry` event that flips a `hasNew` boolean; no listener for `heartbeat`
(ignored implicitly — `EventSource`'s default `message` handler never
fires for named events it isn't listening for). Closes the `EventSource`
on cleanup (dependency change or unmount). Returns `{ hasNew, dismiss }`.

**`apps/web/src/app/(dashboard)/administration/audit/page.tsx` (modified)**
— call the new hook with `enabled: offset === 0`; when `hasNew`, render a
small banner above the `DataTable` ("New audit events — Refresh" button)
that calls the existing `useAuditLog` query's `refetch()` and `dismiss()`
on click. No changes to the pager/filter logic itself.

---

## 5. Sequencing checkpoints

**A — Backend.** `audit-stream.ts` + spec; `audit.listener.ts` emit;
controller `@Sse` route; e2e stream tests.
*Verify: `pnpm --filter @sales-platform/api test` (new spec green);
`pnpm --filter @sales-platform/api test:e2e` (new + full suite green, no
hanging handles).*

**B — Frontend + gateway.** Streaming branch in the BFF route; the new
hook; the banner UI.
*Verify: unlike a plain download, SSE can be watched live with `curl -N`
(streams exactly like a browser) against both the direct API and the BFF
gateway while triggering audit events from another terminal — confirms
`entry`/`heartbeat` frames arrive with the right filtering. Then a real
browser check: open the audit dashboard, trigger an event from another
tab/session, confirm the banner appears without a manual refresh, click it,
confirm the new row shows up.*

**C — Docs.** New `docs/decisions/0012-audit-log-streaming-phase12-scope.md`
(codifying every §0 row, referencing ADR 0010 point 7 and ADR 0009 point 7
for why notifications' polling stance is untouched); `docs/plans/0012-*.md`
(this plan, persisted); `docs/architecture/overview.md` (phase-link entry +
new "Phase 12 scope" section); `README.md` (Phase 12 marked current, Phase
11 loses "(current)"). Full unit + e2e suite, both builds — final gate.

---

## Verification

- After A: `audit-stream.spec.ts` green; new e2e SSE tests green (verify no
  hanging Jest process); full existing suite unaffected.
- After B: `curl -N` byte-level stream inspection (direct + gateway) plus a
  real browser check of the banner-and-refresh flow.
- `pnpm --filter @sales-platform/api build` and `pnpm --filter @sales-platform/web build` clean, final gate.

### Critical files
- `apps/api/src/modules/identity/audit/audit-stream.ts` (new) — event name, types, pure filter-matching
- `apps/api/src/shared/audit/audit.listener.ts` (existing) — emits the new event after a successful insert
- `apps/api/src/modules/identity/audit/audit.controller.ts` (existing) — new `GET /audit-log/stream` SSE route
- `apps/api/test/audit-log.e2e-spec.ts` (existing) — new SSE describe block + raw-stream test helper
- `apps/web/src/app/api/gateway/[...path]/route.ts` (existing) — new streaming branch for `text/event-stream`
- `apps/web/src/hooks/use-audit-log-stream.ts` (new) — `EventSource` wiring
- `apps/web/src/app/(dashboard)/administration/audit/page.tsx` (existing) — "new entries" banner
