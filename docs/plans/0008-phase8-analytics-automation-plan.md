# Phase 8 — Analytics & Automation

## Context

Phases 1-7 (Identity, CRM, Leads, Sales Pipeline, Quotations, Support,
Subscriptions) are built, tested, and running. Unlike every prior phase,
Phase 8 has **no `ComingSoon` stub page** to confirm its route shape — the
scope has to be synthesized from scattered ADR breadcrumbs instead:

- `apps/web/src/app/(dashboard)/page.tsx:27-32` — the dashboard home page's
  placeholder card, verbatim: *"Sales metrics — Arrives in Phase 8 — Pipeline
  value, win rate, MRR/ARR, and the rest of Section 21 once the domain
  modules that feed them exist."* The domain modules now all exist.
- `docs/decisions/0004-sales-phase4-scope.md:47` — "Section 36 dedicates all
  of Phase 8 ('Analytics & Automation') to 'Dashboards, Reports...
  Forecasting'."
- `docs/decisions/0005-quotations-phase5-scope.md:105-112` — accepting a
  quote deliberately does **not** auto-advance its linked Opportunity's
  stage: *"ADR 0004 already pushed this class of automation ('deeper...
  automation') to Phase 8; this is the same call applied here, not a
  silently-dropped feature."* Quotes already carry a nullable
  `opportunityId` FK (`quotes.schema.ts:61`) — the link automation needs
  already exists, just unused.
- `docs/plans/0003-phase3-leads-plan.md:33,42` — "No fuzzy matching — that's
  Phase 8 'Advanced search' territory" and "Leads are not added to Phase 2's
  `SearchService`... §36 places 'Advanced search' in Phase 8."

So Phase 8 is three named, separable pieces: **(A) cross-entity analytics**,
**(B) one concrete automation** (quote acceptance → Opportunity stage), and
**(C) advanced search** (fuzzy matching + Leads onboarded into global
search). Nothing else has a breadcrumb pointing at Phase 8 — in particular
`notifications` (named in ADR 0001's aspirational module list, still zero
implementation) has no phase assignment anywhere and no UI/infra hint of its
shape, so it stays out of scope here, recorded as a deferral rather than
silently built or silently ignored.

---

## 0. Scope decisions

| Decision | Reasoning |
|---|---|
| **Three pieces, each a separate, disciplined increment: Analytics, one Automation, Advanced Search.** No `notifications` module, no fuzzy duplicate-detection upgrade, no multi-widget BI suite beyond the named metrics. | Every included piece has a direct quote pointing at Phase 8; nothing else does. Matches the session's established discipline of building only what's evidenced and recording every cut explicitly. |
| **Analytics: new top-level `apps/api/src/modules/analytics/` module, one endpoint `GET /analytics/dashboard`.** Reads `sales.opportunities` and `subscriptions.subscriptions` **directly** (raw Drizzle queries against their schemas), not via `OpportunitiesService`/`SubscriptionsService` injection. | Same "direct cross-schema reads, no cross-module service DI" precedent Quotes/Support/Subscriptions already established for reading `crm.accounts`/`crm.contacts` — applied here for the first time across two already-built top-level domains instead of into a shared one. Keeps the module dependency graph flat; a few lines of duplicated win-rate arithmetic is cheaper than a new cross-domain DI edge. |
| **Dashboard metrics: exactly 7 fields** — `openPipelineValue`, `weightedPipelineValue`, `winRate`, `openOpportunitiesCount`, `mrr`, `arr`, `activeSubscriptionsCount`. MRR = sum of active subscriptions' snapshotted price, normalized to monthly (yearly ÷ 12); ARR = MRR × 12. | Directly matches the placeholder card's own wording ("Pipeline value, win rate, MRR/ARR"), plus two natural companion counts. A fuller BI dashboard (funnel charts, revenue-over-time, ticket stats) isn't named anywhere — recorded as a deferral, not built. |
| **New permission `analytics.view`**, gating the endpoint. Granted to Owner/Admin (via the existing "all permissions" / "all except org.manage" bundles) and explicitly added to the Member bundle. | No `analytics.*` namespace was pre-reserved in `permissions.ts` (unlike `subscriptions.*` since Phase 1) — first phase needing a genuinely new permission family. Granting it to Member matches today's behavior, where the placeholder dashboard card is visible to every authenticated user with no gate at all. |
| **Automation lives inside `apps/api/src/modules/sales/automation/`, as an event listener — not inside Quotes, and not via direct service injection from Quotes into Sales.** `QuotesService.acceptByToken` already publishes `quote.accepted`; it gains one new field on that payload, `opportunityId: string \| null`. A new `QuoteAcceptedListener` (`@OnEvent("quote.accepted")`) lives in `SalesModule` (which already exports `OpportunitiesService`/`PipelinesService`) and reacts. | `SalesModule` already exports both services it needs — zero new cross-module wiring beyond registering the listener as a provider. This is the *same* concern ADR 0005 decision #9 raised (`quotes.service.ts` doing a live lookup into Sales' pipeline/stage internals) — solved this time by inverting the dependency: Sales reacts to an event Quotes already publishes, so Quotes still knows nothing about Sales. |
| **Automation behavior is narrow and reuses existing guard logic.** New `PipelinesService.findWinStage(organizationId, pipelineId)` (returns the first `isWon` stage, or `undefined`). New `OpportunitiesService.autoAdvanceOnQuoteAccepted(organizationId, opportunityId)`: no-ops if the opportunity is already closed (`outcome !== "open"`) or its pipeline has no win stage; otherwise moves it to that stage (same field-set as `moveStage`: `stageId`, `probability` from the stage, `outcome: "won"`, `closedAt: now`) and publishes the *existing* `opportunity.stage_changed` event — no new event type. `updatedBy`/`actorId` are left unset (system-originated), matching the exact precedent `SubscriptionsService.lapseIfDue()` already set for system-triggered writes. | Reuses `moveStage`'s exact semantics without touching its signature (which requires a real `actorId` for the controller-facing path) — a small dedicated method, same "one explicit method per action" style as `cancel`/`renew` on Subscriptions, rather than loosening a shared method's contract. Publishing the pre-existing event means Timeline needs zero changes — a manual and an automated stage move look identical on the account timeline. |
| **The listener is best-effort: caught and logged, never throws back into the request path.** Quote acceptance (a public, unauthenticated, token-based action) must succeed regardless of whether the automation runs. | Same posture already established for every `MailListener`/`AuditListener` handler — log and move on, never block the operation that triggered the event. |
| **Advanced search: `pg_trgm` extension + fuzzy (typo-tolerant) ranking added to the existing `SearchService`, and Leads onboarded as a third searchable type.** Each per-type query becomes `WHERE search_vector @@ plainto_tsquery(...) OR <name-expr> % :q`, ranked by `GREATEST(ts_rank(...), similarity(<name-expr>, :q))`. Leads get the same generated-`tsvector`-column treatment `crm.accounts`/`crm.contacts` already have (weight A: `name`, weight B: `company`), plus a trigram GIN index. `SearchResultDto.type` gains `"lead"`; `SearchController` gates it behind `leads.view`, filtered out (not 403'd) when absent — same silent-exclusion behavior already used for account/contact. | Directly fulfills both named breadcrumbs ("no fuzzy matching," "Leads not in `SearchService`") with one coherent change to one file (`search.service.ts`) plus the same schema-migration pattern already used twice for tsvector columns. `pg_trgm` is a built-in Postgres extension, not new infrastructure — consistent with the "avoid new infra unless a concrete need forces it" discipline ADR 0001 already established. |
| **No new frontend surface for Leads-in-search.** The one existing consumer, `apps/web/src/hooks/use-search.ts` (used only by the Accounts page's inline typeahead), keeps its current default (`types` omitted → account+contact only) so that page's behavior is unchanged. `"lead"` is a valid, permission-gated `types` value on the API from day one, ready for a future consumer. | No global command-palette or search page exists anywhere in the frontend to extend — inventing one would be scope creep unrelated to any named Phase 8 item. Recorded as a deliberate backend-ahead-of-frontend cut, the mirror image of Phase 7's "renewal history not surfaced as an endpoint" deferral. |
| **`notifications` module: explicitly out of scope, still just reserved.** No in-app notification concept (bell icon, unread state, delivery preferences) exists anywhere in the frontend or API today, and no ADR/stub assigns it to Phase 8 specifically. | Distinguishing "named for Phase 8" (Analytics, Automation, Advanced Search) from "reserved since Phase 1 with no phase assignment" (`notifications`) keeps this phase's scope exactly as evidenced, not inflated. Recorded in the new ADR so it isn't silently forgotten either. |

---

## 1. Data model

**No new tables.** Two additive migrations against existing schemas:

`apps/api/src/database/schema/leads.schema.ts` — add one column to `leads`:
```ts
searchVector: text("search_vector"),
```
(typed as `text` like `crm.schema.ts` already does — Drizzle has no
first-class `tsvector` type; the real column type + generated expression is
hand-written in the migration SQL, same established technique.)

Migration (raw SQL, following `0001_supreme_rockslide.sql`'s exact pattern):
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "leads"."leads" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("company", '')), 'B')
) STORED;
CREATE INDEX IF NOT EXISTS "leads_search_idx" ON "leads"."leads" USING gin ("search_vector");

CREATE INDEX IF NOT EXISTS "accounts_name_trgm_idx" ON "crm"."accounts" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "contacts_name_trgm_idx" ON "crm"."contacts" USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "leads_name_trgm_idx" ON "leads"."leads" USING gin ("name" gin_trgm_ops);
```

`pnpm --filter @sales-platform/api db:generate` will not produce the
generated-column/extension/trigram-index statements correctly (same
limitation already hit for the original tsvector columns) — hand-write this
migration file directly, following `0001_supreme_rockslide.sql` as the
template, and update `meta/_journal.json` + a matching snapshot the way
drizzle-kit expects. Verify with `db:migrate` against the dev DB.

---

## 2. Contracts

`packages/contracts/src/analytics.ts` (new):
```ts
export interface DashboardStatsDto {
  openPipelineValue: number;
  weightedPipelineValue: number;
  winRate: number;
  openOpportunitiesCount: number;
  mrr: number;
  arr: number;
  activeSubscriptionsCount: number;
}
```
Export from `packages/contracts/src/index.ts`.

`packages/contracts/src/crm.ts` — `SearchResultDto.type` widens to
`"account" | "contact" | "lead"`.

No new Zod input schemas needed — `/analytics/dashboard` takes no body, and
`/search` already takes `q`/`types`/`limit` query params.

---

## 3. Permissions & events

`packages/contracts/src/permissions.ts` — add `"analytics.view"` to
`PERMISSIONS` (new family, not previously reserved) and to the `MEMBER`
bundle. Owner/Admin get it automatically (their bundles are computed from
the full `PERMISSIONS` list).

`packages/contracts/src/events.ts` — no new event types. `quote.accepted`'s
payload (informally typed, `Record<string, unknown>` at the bus level) gains
one field at the call site: `opportunityId: quote.opportunityId`. No change
to `SUBSCRIPTIONS_EVENT_TYPES`/`TIMELINE_EVENT_TYPES`/any const array —
`opportunity.stage_changed` (already timeline-worthy since Phase 4) is
reused verbatim by the automation path.

---

## 4. Backend modules

**Analytics** (`apps/api/src/modules/analytics/`):
- `analytics.service.ts` — `AnalyticsService.dashboard(organizationId)`:
  one query against `sales.opportunities` grouped by `outcome` (same shape
  as `OpportunitiesService.summaryStats`, computed independently per §0),
  one query against `subscriptions.subscriptions` where `status = 'active'`
  summing `price` normalized by `billingInterval` (`yearly` → `/12`).
- `analytics.controller.ts` — `@Controller("analytics")`, `GET /dashboard`
  gated `analytics.view`.
- `analytics.module.ts` — registers both, no exports.
- Register in `app.module.ts` after `SubscriptionsModule`.

**Automation** (`apps/api/src/modules/sales/automation/`):
- `quote-accepted.listener.ts` — `@Injectable() QuoteAcceptedListener`,
  `@OnEvent("quote.accepted") async onQuoteAccepted(event)`: if
  `event.payload.opportunityId` is set, wrapped in try/catch (log + swallow
  on error, per §0), calls
  `this.opportunities.autoAdvanceOnQuoteAccepted(event.organizationId, event.payload.opportunityId)`.
  Registered as a provider in `SalesModule` (already exports the services it
  needs — no new module imports).
- `pipelines.service.ts` — add `findWinStage(organizationId, pipelineId)`:
  selects the first `stages` row with `pipelineId` match and `isWon = true`,
  ordered by `order`, returns `undefined` if none (no throw — the caller
  treats "no win stage" as a normal no-op, not an error).
- `opportunities.service.ts` — add `autoAdvanceOnQuoteAccepted(organizationId, opportunityId)`:
  loads the opportunity (returns silently if not found/deleted — defensive,
  since this runs off an async event); no-ops if `outcome !== "open"`; looks
  up `findWinStage`; no-ops if none; otherwise performs the same update
  `moveStage` performs (`stageId`, `probability: stage.probability`,
  `outcome: "won"`, `closedAt: new Date()`, `updatedAt: new Date()`, no
  `updatedBy`) and publishes `opportunity.stage_changed` with the same
  payload shape `moveStage` already uses, `actorId` omitted.
- `quotes.service.ts` — `acceptByToken`'s existing `events.publish(...)`
  call (`quotes.service.ts:428-432`) gains `opportunityId: quote.opportunityId`
  in its payload. No other change to Quotes.

**Search** (existing `apps/api/src/modules/crm/search/`):
- `search.service.ts` — `SearchOptions.types` widens to include `"lead"`.
  Each existing per-type block (`accounts`, `contacts`) gets its `WHERE`
  clause extended with `OR <name-expr> % ${q}` and its `rank` expression
  changed to `GREATEST(ts_rank(...), similarity(<name-expr>, ${q}))`. A new
  third block queries `leads.leads` the same way (`label: name`,
  `subLabel: company`).
- `search.controller.ts` — `requested` type parsing/`allowed` filtering
  extended with `"lead"` gated on `user.permissions.includes("leads.view")`,
  same silent-exclusion pattern as account/contact.

**Route table (new/changed only):**

| Method | Path | Permission |
|---|---|---|
| GET | `/analytics/dashboard` | `analytics.view` |
| GET | `/search?types=account,contact,lead` | filtered per-type by existing view perms (lead → `leads.view`) |

No new routes for automation — it's event-driven, not HTTP-triggered.

---

## 5. Cross-module & infra wiring

- `apps/api/package.json` — no new dependency (`pg_trgm` is a built-in
  Postgres extension, `@nestjs/event-emitter` already in place since Phase
  1).
- `apps/api/src/app.module.ts` — import `AnalyticsModule`.
- `apps/api/src/modules/sales/sales.module.ts` — add `QuoteAcceptedListener`
  to `providers` (no new imports; it only uses `OpportunitiesService`/
  already-injectable within the same module).
- No changes to `TimelineService` — `opportunity.stage_changed` is already
  handled.

---

## 6. e2e testing strategy

New `apps/api/test/analytics.e2e-spec.ts`: seed a couple of opportunities
(one won, one lost, one open with a known value/probability) and a couple
of subscriptions (one monthly, one yearly, one cancelled) directly via their
existing service/HTTP layers, then call `GET /analytics/dashboard` and
assert each of the 7 fields against hand-computed expected values; RBAC
(Member can view, confirm the permission gate exists); cross-tenant
isolation (a second org's data doesn't leak into the totals).

New `apps/api/test/sales-automation.e2e-spec.ts`: create an Account, an
Opportunity linked via `opportunityId` on a Quote, send + accept the quote
via the public token flow, then `GET` the opportunity and assert
`outcome: "won"` and `stageId` equals the pipeline's win stage; a second
case where the opportunity was already closed before acceptance (assert no
change / no duplicate `stage_changed` event); a third case where
`opportunityId` is null on the quote (assert nothing happens, quote
acceptance still succeeds). Confirm the account timeline shows the
`opportunity.stage_changed` entry after automated advancement (same
extension-point proof pattern as Phases 6/7).

Extend the existing `apps/api/test/crm-search.e2e-spec.ts`: typo-tolerant
match on an account name (e.g.
searching `"Acmee"` finds `"Acme Corp"` via trigram similarity); a Lead
appears in results when `types=lead` and is absent by default; RBAC
(`types=lead` silently excluded without `leads.view`, same as the existing
account/contact test if one exists).

---

## 7. Frontend

`apps/web/src/hooks/use-analytics.ts` (new) — `useDashboardStats()`,
`useQuery` against `analytics/dashboard`, same shape as every other hook
file.

`apps/web/src/app/(dashboard)/page.tsx` — replace the "Sales metrics /
Arrives in Phase 8" and "Next up / Phase 2 — CRM" placeholder cards (both
now stale) with real stat cards fed by `useDashboardStats()`: a "Pipeline"
card (open value, weighted value, win rate), a "Recurring revenue" card
(MRR, ARR), keeping the existing "Your permissions" card as-is. Gate the
fetch/cards on `user.permissions.includes("analytics.view")` (Member+ has
it by default per §3, so this is mostly a loading-state concern, not an
access-control one client-side — the server route is the real gate).

No changes to `apps/web/src/hooks/use-search.ts` or the Accounts page (per
§0's explicit "no new frontend surface" decision).

---

## 8. Sequencing checkpoints (system stays runnable + tested after each)

**A — Analytics: schema-free, contracts + permission + module, tested.**
`analytics.ts` contract (new) + barrel; `permissions.ts` (`analytics.view`);
`AnalyticsService`/`Controller`/`Module`; register in `app.module.ts`.
`apps/api/test/analytics.e2e-spec.ts`.
*Verify: e2e green; full suite unaffected.*

**B — Automation: event payload + listener + service methods, tested.**
`quotes.service.ts` payload change; `pipelines.service.ts` (`findWinStage`);
`opportunities.service.ts` (`autoAdvanceOnQuoteAccepted`);
`quote-accepted.listener.ts`; register in `SalesModule`.
`apps/api/test/sales-automation.e2e-spec.ts`.
*Verify: e2e green, including the existing `quotes`/`sales` suites
(unchanged behavior for quotes with no linked opportunity).*

**C — Advanced search: migration + service + controller, tested.**
`leads.schema.ts` (`searchVector` column) + migration (`pg_trgm` extension,
generated column, trigram indexes) + `db:migrate`; `search.service.ts` +
`search.controller.ts` changes; contracts `SearchResultDto.type`.
`apps/api/test/crm-search.e2e-spec.ts` (extended).
*Verify: e2e green; manually confirm a typo'd query still finds a seeded
account via `curl` against the dev API.*

**D — Frontend.**
`use-analytics.ts`; dashboard home page rewrite.
*Verify manually via dev server*: log in, confirm the dashboard home page
shows real pipeline/MRR/ARR numbers matching what's in the DB; accept a
quote linked to an Opportunity and confirm its stage flips to the pipeline's
Closed Won stage automatically, visible on both the Kanban board and the
account timeline.

**E — Docs + full verification.**
`docs/decisions/0008-analytics-automation-phase8-scope.md` (new ADR,
codifying every §0 row — the analytics-metrics scope, the direct-schema-read
choice, the automation-as-listener-in-Sales choice, the fuzzy-search +
Leads-onboarding choice, the notifications-stays-deferred decision);
`docs/plans/0008-phase8-analytics-automation-plan.md` (this plan,
persisted); `docs/architecture/overview.md` update (module list gains
`analytics`; events section notes the `quote.accepted` payload addition and
the reused `opportunity.stage_changed` automation path; new "Phase 8 scope"
section; deferred-tech/notifications note); `README.md` — Phase 8 marked
current, feature summary, dashboard home page mention. Full unit + e2e
suite, both builds, manual smoke test as in D — final gate.

---

## Verification

- After A-C: e2e green after each new/extended spec file.
- After D: manual verification via `pnpm dev` — real dashboard numbers,
  live quote-acceptance-triggers-stage-move, a fuzzy search hit.
- `pnpm --filter @sales-platform/api build` and
  `pnpm --filter @sales-platform/web build` clean, final gate.

### Critical files
- `apps/api/src/modules/analytics/analytics.service.ts` (new) — the 7-metric cross-schema aggregation
- `apps/api/src/modules/sales/automation/quote-accepted.listener.ts` (new) — the automation entry point
- `apps/api/src/modules/sales/opportunities/opportunities.service.ts` (existing) — gains `autoAdvanceOnQuoteAccepted`
- `apps/api/src/modules/sales/pipelines/pipelines.service.ts` (existing) — gains `findWinStage`
- `apps/api/src/modules/quotes/quotes.service.ts` (existing) — `quote.accepted` payload gains `opportunityId`
- `apps/api/src/modules/crm/search/search.service.ts` (existing) — fuzzy ranking + Leads block
- `apps/api/src/database/schema/leads.schema.ts` (existing) — gains `searchVector`
- New hand-written migration — `pg_trgm` extension, leads tsvector column, trigram indexes
- `apps/web/src/app/(dashboard)/page.tsx` (existing) — real metrics replace the Phase 8 placeholder
