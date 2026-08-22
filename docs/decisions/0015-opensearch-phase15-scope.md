# ADR 0015: OpenSearch Phase 15 scope — a real, pluggable search backend, Postgres stays default

## Status

Accepted — 2026-08-22

## Context

[ADR 0001](0001-modular-monolith.md) deferred OpenSearch from day one:
"Postgres full-text search (`tsvector`) covers Phase 1-7 search volume." The
architecture overview's deferral table names the trigger to add it back as
"Postgres full-text search stops being fast enough at real data volume" — a
trigger that, honestly, has not fired in this app: the existing Postgres
search, extended in Phase 8 with `pg_trgm` fuzzy matching, works correctly
and is covered by a real e2e suite (`crm-search.e2e-spec.ts`). The user asked
to work through the five originally-deferred items regardless, continuing
after [RabbitMQ (Phase 14)](0014-rabbitmq-audit-transport-phase14-scope.md).

Given that, this phase is scoped honestly: build a real, fully-working,
pluggable alternative search backend with genuine feature parity — not a
demo stub — but keep Postgres as the default, since the concrete trigger for
switching has not occurred. This mirrors exactly how Phase 13 (Payments) and
Phase 14 (RabbitMQ) each introduced a real, working, opt-in capability behind
a safe default rather than forcing a switch that is not yet justified by
need.

**Current state**: `SearchService`/`SearchController`
(`apps/api/src/modules/crm/search/`) expose `GET /search?q=&types=&limit=`,
searching `crm.accounts`, `crm.contacts`, and (opt-in) `leads.leads` via raw
SQL blending `ts_rank` (tsvector) and `similarity` (pg_trgm) into one ranked
list. Every entity's row already publishes domain events on create/update/
delete (`account.created/updated/deleted`, etc.) via the existing
`DomainEventBus` — the same hook `AuditListener` already uses — so an
index-sync listener needs no new publish call sites.

## Decisions

**1. New `SearchProvider` interface, two implementations selected by a
factory provider via `SEARCH_PROVIDER=postgres|opensearch`** (default
`postgres`) — exact mirror of `PAYMENT_PROVIDER`/`EVENT_BUS_TRANSPORT`.
`PostgresSearchProvider` is the *current* `SearchService` body moved
verbatim into a class implementing the interface — zero behavior change,
`crm-search.e2e-spec.ts` passes unmodified. `SearchService` becomes a thin
wrapper: unchanged permission-gating in `SearchController`, then delegates
to the active provider.

**2. Graceful degradation, not just a safe default.** If the active provider
is `opensearch` and a query throws (cluster down, timeout, anything),
`SearchService` catches it and falls back to `PostgresSearchProvider` for
that request rather than failing it. Postgres is always live authoritative
data, so this is a strictly safe fallback — unlike Payments/RabbitMQ, search
is a pure read path with no state to lose. Matches the "never break the
operation" ethos from every prior provider phase, here applied to a read
instead of a write.

**3. Index kept in sync via a new `SearchIndexListener`** — a wildcard
`@OnEvent("domain.event")` subscriber (sibling to `AuditListener`), active
only when `SEARCH_PROVIDER=opensearch`. On `account`/`contact`/`lead`
`.created`/`.updated`, it re-reads the current row directly (a minimal
query, not the full service layer) and upserts it into OpenSearch; on
`.deleted`, it deletes the document. Re-reading fresh state (rather than
trusting the event payload, which does not always carry every field — an
`.updated` event's payload is `{ id, changes }`, a partial diff) keeps the
index correct regardless of what a given event's payload happens to
include. Never throws — logs and continues, since a missed index update
must never break the write that triggered it. No new publish call sites
needed — reuses the exact hook `AuditListener` already proved out in
Phase 14.

**4. One shared OpenSearch index** (`crm-search`), not one per organization
— documents carry an `organizationId` keyword field, filtered on every
query. `_id` is `${type}:${entityId}` (composite, unique, enables direct
delete-by-id). Consistent with how every other part of this app does
multi-tenancy: one shared store, always filtered by `organizationId`, never
per-tenant infrastructure.

**5. The index is created with an explicit mapping, never left to dynamic
inference.** `type`/`entityId`/`organizationId` are `keyword`; `label`/
`subLabel` are `text`. This was not a stylistic choice — OpenSearch's
dynamic mapping infers string fields as analyzed `text`, and a `term` filter
against an analyzed field silently matches zero documents (no exception, it
just returns empty). An `ensureSearchIndex(client)` function creates the
index up front (idempotent — checks existence first, swallows a
`resource_already_exists_exception` race) and is called from both
`OpenSearchSearchProvider` and the standalone reindex script, so the mapping
has exactly one source of truth.

**6. Query approach**: OpenSearch's built-in `multi_match` with
`fuzziness: "AUTO"` and BM25 relevance, filtered by `organizationId` + `type`
terms — replaces the hand-rolled `ts_rank`/`pg_trgm` blend with OpenSearch's
native equivalent. `refresh: "wait_for"` on every index/delete write, trading
a little write throughput for read-your-writes consistency — acceptable at
this app's scale, and necessary for the e2e tests to be non-flaky.

**7. A small standalone reindex script**,
`apps/api/src/database/reindex-search.ts` (`pnpm search:reindex`), mirroring
`migrate.ts`'s style (no Nest DI, connects directly). Needed because
switching `SEARCH_PROVIDER=opensearch` on an existing database starts from
an empty index — `SearchIndexListener` only keeps it in sync going forward,
it does not backfill history.

**8. `docker-compose.yml`** gains an `opensearch` service
(`opensearchproject/opensearch:2`, single-node, security plugin disabled,
heap capped at `-Xms512m -Xmx512m`, port shifted to `9201:9200`), the
heaviest dependency added so far. The image requires
`OPENSEARCH_INITIAL_ADMIN_PASSWORD` to be set even with
`plugins.security.disabled=true` — OpenSearch 2.12+'s security-plugin demo
config installer aborts without it regardless of the disable flag; the
password only satisfies that setup step, confirmed via an unauthenticated
`curl` against `_cluster/health` returning `"status":"green"` at runtime.
Healthcheck against `_cluster/health` is given a longer startup budget than
Postgres/Redis/RabbitMQ, since the JVM cold-start is measurably slower (a
transient CPU spike from bundled plugin initialization was observed and
confirmed benign via `docker stats`, not a resource-exhaustion problem).

**9. `@opensearch-project/opensearch`** used directly (the official client)
— matches house style (`amqplib`, `stripe`, `postgres` are all used as plain
client libraries, no framework wrapper).

**10. Testing**: `opensearch-search.provider.spec.ts`
(`jest.mock("@opensearch-project/opensearch")`, mirroring
`jest.mock("amqplib")`) covers query building, hit mapping, index-creation/
mapping, and index/delete document calls. `search-index.listener.spec.ts`
covers no-op-on-postgres, index-on-created/updated per entity type,
delete-on-deleted, and error-swallowing. `search.service.spec.ts` locks in
the fallback-to-Postgres-on-failure behavior — the same regression-locking
spirit as `audit.listener.spec.ts`'s fallback test. A new
`test/search-opensearch.e2e-spec.ts` sets `SEARCH_PROVIDER=opensearch`/
`OPENSEARCH_URL` before importing the shared test bootstrap (the exact
pattern `rabbitmq-audit.e2e-spec.ts` established) and drives a real
create-account-then-search round-trip, and a delete-then-confirm-removed
round-trip, against the actual `opensearch` container — proving genuine
index + query behavior, not just that a write call did not throw. The full
existing unit (97/97) and e2e suites were re-run under the default
`SEARCH_PROVIDER=postgres` and stayed green with zero regressions, since
that code path is a byte-for-byte extraction of the pre-existing logic.

**11. Not built this phase**: the topbar global-search UI
(`apps/web/src/components/layout/app-topbar.tsx` still has its "lands here
in a later phase" placeholder — unrelated to which backend powers
`/search`, a separate, pre-existing frontend gap); expanding search to
opportunities/quotes/tickets/products (an orthogonal scope question, not
something OpenSearch enables that Postgres could not); OpenSearch security/
auth hardening; multi-index sharding; semantic/kNN vector search (parity
with the existing feature set is fuzzy text match, not a new capability).
Each is a reasonable, separable future increment, recorded here rather than
silently gapped.

## Consequences

- A real, opt-in OpenSearch-backed search path now exists
  (`SEARCH_PROVIDER=opensearch`), with genuine feature parity to the
  existing Postgres search (fuzzy multi-field matching, organization
  filtering, entity-type filtering) plus a fallback to Postgres on any
  provider failure — but Postgres search remains the default, since the
  documented trigger for switching (search volume outgrowing Postgres) has
  not occurred.
- Switching to OpenSearch on an existing populated database requires running
  `pnpm search:reindex` once — this is now a documented manual step, the
  same way `db:migrate` already is.
- OpenSearch is now running in the local/dev topology
  (`docker-compose.yml`) as the heaviest dependency added so far; its
  slower JVM cold-start is accounted for in the e2e test timeout and the
  compose healthcheck's retry budget.
- The `ensureSearchIndex` mapping fix (explicit `keyword` types for filtered
  fields) is a correctness fix that generalizes: any future OpenSearch index
  added to this app should create its mapping explicitly rather than relying
  on dynamic inference, to avoid the same silent-empty-query failure mode.
- Keycloak, Temporal, and the microservices split remain the last three of
  the five originally-deferred items, picked up next per the ordering in
  [ADR 0014](0014-rabbitmq-audit-transport-phase14-scope.md).
