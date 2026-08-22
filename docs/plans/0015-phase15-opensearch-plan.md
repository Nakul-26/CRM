# Phase 15 — OpenSearch (pluggable global-search backend)

## Context

[ADR 0001](../decisions/0001-modular-monolith.md) deferred OpenSearch on day one: "Postgres full-text search (`tsvector`) covers Phase 1–7 search volume." The architecture overview's deferral table names the trigger to add it back as "Postgres full-text search stops being fast enough at real data volume" — a trigger that, honestly, hasn't actually fired in this app (the existing Postgres search, extended in Phase 8 with `pg_trgm` fuzzy matching, works correctly and is covered by a real e2e suite, `crm-search.e2e-spec.ts`). The user asked to work through the remaining deferred items regardless, continuing after [RabbitMQ (Phase 14)](../decisions/0014-rabbitmq-audit-transport-phase14-scope.md).

Given that, this phase is scoped honestly: build a **real, fully-working, pluggable alternative search backend** with genuine feature parity — not a demo stub — but keep Postgres as the default, since the concrete trigger for switching hasn't occurred. This mirrors exactly how Phase 13 (Payments) and Phase 14 (RabbitMQ) each introduced a real, working, opt-in capability behind a safe default rather than forcing a switch that isn't yet justified by need.

**Current state** (confirmed by reading the code): `SearchService`/`SearchController` (`apps/api/src/modules/crm/search/`) expose `GET /search?q=&types=&limit=`, searching `crm.accounts`, `crm.contacts`, and (opt-in) `leads.leads` via raw SQL blending `ts_rank` (tsvector) and `similarity` (pg_trgm) into one ranked list. Every entity's row already publishes domain events on create/update/delete (`account.created/updated/deleted`, etc.) via the existing `DomainEventBus` — the same hook `AuditListener` already uses — so an index-sync listener needs no new publish call sites.

## Scope decisions

| Decision | Reasoning |
|---|---|
| **New `SearchProvider` interface**, two implementations selected by a factory provider via **`SEARCH_PROVIDER=postgres\|opensearch`** (default `postgres`) — exact mirror of `PAYMENT_PROVIDER`/`EVENT_BUS_TRANSPORT`. `PostgresSearchProvider` is the *current* `SearchService` body, moved verbatim into a class implementing the interface — zero behavior change, `crm-search.e2e-spec.ts` must pass unmodified. `SearchService` becomes a thin wrapper: unchanged permission-gating in `SearchController`, then delegates to the active provider. | Same "pluggable provider, safe default" shape as Payments/RabbitMQ. Keeping `PostgresSearchProvider` a byte-for-byte extraction (not a rewrite) means the existing, already-tested search behavior can't regress. |
| **Graceful degradation, not just a safe default.** If the active provider is `opensearch` and a query throws (broker down, timeout, anything), `SearchService` catches it and falls back to `PostgresSearchProvider` for that request rather than failing it. Postgres is always live authoritative data, so this is a strictly safe fallback — unlike Payments/RabbitMQ, search is a pure read path with no state to lose. | Matches the "never break the operation" ethos from every prior provider phase — here applied to a read instead of a write. |
| **Index kept in sync via a new `SearchIndexListener`** — a wildcard `@OnEvent("domain.event")` subscriber (sibling to `AuditListener`), active only when `SEARCH_PROVIDER=opensearch`. On `account`/`contact`/`lead` `.created`/`.updated`, it re-reads the current row directly (a minimal query, not the full service layer) and upserts it into OpenSearch; on `.deleted`, it deletes the document. Re-reading fresh state (rather than trusting the event payload, which may not carry every field) keeps the index correct regardless of what a given event's payload happens to include. Never throws — logs and continues, since a missed index update must never break the write that triggered it. | No new publish call sites needed — reuses the exact same hook `AuditListener` already proved out in Phase 14. Re-reading avoids a subtle staleness bug if a payload is ever partial. |
| **One shared OpenSearch index** (`crm-search`), not one per organization — documents carry an `organizationId` keyword field, filtered on every query. `_id` is `${type}:${entityId}` (composite, unique, enables direct delete-by-id). | Consistent with how every other part of this app does multi-tenancy: one shared store, always filtered by `organizationId`, never per-tenant infrastructure. |
| **Query approach**: OpenSearch's built-in `multi_match` with `fuzziness: "AUTO"` and BM25 relevance, filtered by `organizationId` + `type` terms — replaces the hand-rolled `ts_rank`/`pg_trgm` blend with OpenSearch's native equivalent (fuzzy matching is a first-class feature, not something to hand-roll a second time). `refresh: "wait_for"` on every index/delete write, trading a little write throughput for read-your-writes consistency — acceptable at this app's scale, and necessary for e2e tests to be non-flaky. | Don't reimplement what the search engine already does natively; use its idiomatic relevance model instead of forcing Postgres's model onto it. |
| **A small standalone reindex script**, `apps/api/src/database/reindex-search.ts` (`pnpm search:reindex`), mirroring `migrate.ts`'s style (no Nest DI, connects directly). Needed because switching `SEARCH_PROVIDER=opensearch` on an existing database starts from an empty index — this is the operational step that makes the switch usable, the same way `db:migrate` already is a manual step in the documented setup flow. | Without it, flipping the flag on a populated dev DB would silently show empty search results until the next write to each row — a real, avoidable gap. |
| **`docker-compose.yml`** gains an `opensearch` service — single-node, security plugin disabled (dev/test simplicity, documented production-hardening gap, same spirit as RabbitMQ's `guest`/`guest` dev credentials), heap capped (e.g. `-Xms512m -Xmx512m`) since it's the heaviest dependency added so far, ports shifted like every other local service, healthcheck against `_cluster/health` with a longer startup budget than Postgres/Redis/RabbitMQ (JVM cold-start is slower). Exact env incantation (OpenSearch's security-disable flags vary a little by version) verified empirically against a real running container during implementation, same as Phase 14's port/healthcheck tuning was. | Real infra, not a mock — matches how every other opt-in dependency in this app (Stripe, RabbitMQ) is a genuine, runnable integration. |
| **`@opensearch-project/opensearch`** used directly (the official client) — matches house style (`amqplib`, `stripe`, `postgres` are all used as plain client libraries, no framework wrapper). | Consistency with every prior provider phase. |
| **Not built this phase**: the topbar global-search UI (`apps/web/src/components/layout/app-topbar.tsx` still has its "lands here in a later phase" placeholder — unrelated to *which backend* powers `/search`, a separate, pre-existing frontend gap); expanding search to opportunities/quotes/tickets/products (an orthogonal scope question, not something OpenSearch enables that Postgres couldn't); OpenSearch security/auth hardening; multi-index sharding; semantic/kNN vector search (parity with the existing feature set — fuzzy text match, not a new capability). | Each is a reasonable, separable future increment, recorded here rather than silently gapped. |

## Backend

### `docker-compose.yml`
Add an `opensearch` service (`opensearchproject/opensearch:2`, single-node, security disabled, heap-capped, shifted port e.g. `9201:9200`, named volume, healthcheck against `_cluster/health`).

### Env — `packages/config/src/env.ts`
```ts
SEARCH_PROVIDER: z.enum(["postgres", "opensearch"]).default("postgres"),
OPENSEARCH_URL: z.string().optional(),
```
`apps/api/.env.example`: add both, same "only needed when opted in" comment style as `PAYMENT_PROVIDER`/`EVENT_BUS_TRANSPORT`.

### `apps/api/package.json`
Add `@opensearch-project/opensearch` (dependency). New script: `"search:reindex": "tsx src/database/reindex-search.ts"`.

### `apps/api/src/modules/crm/search/providers/` (new directory, mirrors `payments/providers/`)
- `search-provider.interface.ts` — `SearchProvider` interface (`kind`, `search(organizationId, q, options): Promise<SearchResultDto[]>`), `SEARCH_PROVIDER` Symbol token, `SearchOptions` (moved from `search.service.ts`).
- `postgres-search.provider.ts` — the current `SearchService.search()` body, moved verbatim, `kind = "postgres"`.
- `opensearch-search.provider.ts` — `kind = "opensearch"`; lazy `getClient()` (mirrors `RabbitMQAuditTransport`'s lazy-connection idiom — never touches `OPENSEARCH_URL` unless actually invoked); `search()` (multi_match + filters, described above); `indexDocument(doc)`/`deleteDocument(type, entityId)` used by the listener and the reindex script.

### `apps/api/src/modules/crm/search/search-index.listener.ts` (new)
Wildcard `@OnEvent("domain.event")` listener, no-ops immediately unless `SEARCH_PROVIDER=opensearch`; re-reads the current row for `account`/`contact`/`lead` `.created`/`.updated` and calls `indexDocument`, calls `deleteDocument` on `.deleted`; catches and logs all errors.

### `apps/api/src/modules/crm/search/search.service.ts` (existing, modified)
Becomes the thin delegate + fallback described above. `SearchController`'s permission-gating logic is untouched.

### `apps/api/src/modules/crm/crm.module.ts` (existing, modified)
Register the two providers, the `SEARCH_PROVIDER` factory (mirrors `payments.module.ts`'s factory-provider pattern), and `SearchIndexListener`.

### `apps/api/src/database/reindex-search.ts` (new)
Standalone script (no Nest DI, connects directly — mirrors `migrate.ts`): reads all non-deleted accounts/contacts/leads across all orgs, indexes each into OpenSearch.

## Testing

- **Unit**: `opensearch-search.provider.spec.ts` (`jest.mock("@opensearch-project/opensearch")`, mirrors `jest.mock("amqplib")`) — query building, hit mapping, index/delete calls.
- **Unit**: `search-index.listener.spec.ts` — no-ops when provider is `postgres`; indexes/deletes correctly per event type when `opensearch`; swallows errors.
- **Unit**: extend/add `search.service.spec.ts` — locks in the fallback-to-Postgres-on-failure behavior (same regression-locking spirit as `audit.listener.spec.ts`'s fallback test).
- **New e2e**: `apps/api/test/search-opensearch.e2e-spec.ts` — sets `SEARCH_PROVIDER=opensearch`/`OPENSEARCH_URL` before importing `./setup/test-app` (exact pattern from `rabbitmq-audit.e2e-spec.ts`), creates an account, polls `GET /search` against the real container until it appears — proving genuine index + query round-trip.
- **Regression**: full existing unit + e2e suites re-run under the default `SEARCH_PROVIDER=postgres` — `crm-search.e2e-spec.ts` must be byte-for-byte unaffected.
- `test-app.ts`: `process.env.SEARCH_PROVIDER ??= "postgres"`.

## Docs

- `docs/decisions/0015-opensearch-phase15-scope.md`.
- `docs/plans/0015-phase15-opensearch-plan.md` (this plan, persisted).
- `docs/architecture/overview.md` — phase-link entry, deferral-table row update (same treatment RabbitMQ's row got in Phase 14), new "Phase 15 scope" section.
- `README.md` — Phase 15 marked current (Phase 14 loses it); prerequisites/getting-started notes mention OpenSearch is optional.

## Verification

1. `docker compose up -d opensearch`, confirm healthy (allow a longer startup budget than the other services).
2. Unit tests green.
3. New e2e spec green against the real container.
4. Full existing unit + e2e suites green under the default `SEARCH_PROVIDER=postgres` (no regression).
5. `pnpm search:reindex` runs cleanly against a populated dev DB and OpenSearch, and `GET /search` (with `SEARCH_PROVIDER=opensearch`) returns the reindexed data.
6. `pnpm --filter @sales-platform/api build` clean (no frontend changes this phase).

### Critical files
- `apps/api/src/modules/crm/search/providers/opensearch-search.provider.ts` (new)
- `apps/api/src/modules/crm/search/providers/postgres-search.provider.ts` (new, extracted from `search.service.ts`)
- `apps/api/src/modules/crm/search/search-index.listener.ts` (new)
- `apps/api/src/modules/crm/search/search.service.ts` (existing) — thin delegate + fallback
- `apps/api/src/modules/crm/crm.module.ts` (existing) — provider factory wiring
- `apps/api/src/database/reindex-search.ts` (new)
- `packages/config/src/env.ts` (existing) — `SEARCH_PROVIDER`, `OPENSEARCH_URL`
- `docker-compose.yml` (existing) — new `opensearch` service
- `apps/api/test/search-opensearch.e2e-spec.ts` (new)

---

## Remaining deferred items after this phase

1. ~~RabbitMQ~~ — done (Phase 14).
2. ~~OpenSearch~~ — done (this phase).
3. **Temporal** — durable workflow orchestration (e.g. subscription renewal retries/dunning), next.
4. **Keycloak** — swap first-party JWT/refresh-token auth for OIDC federation; most invasive of the remaining items (touches every module's auth), sequenced after the lower-risk infra additions.
5. **Microservices split** — extracting one or more modules into separately deployable services, last, per ADR 0001's own "Consequences" section.
