# ADR 0008: Analytics & Automation Phase 8 scope — dashboard metrics, one quote-acceptance automation, and fuzzy/Leads search

## Status

Accepted — 2026-08-17

## Context

Unlike every prior phase, Phase 8 has no `ComingSoon` stub page confirming
its route shape — the scope had to be synthesized from scattered ADR
breadcrumbs instead:

- `apps/web/src/app/(dashboard)/page.tsx`'s dashboard home page placeholder
  card, verbatim: "Sales metrics — Arrives in Phase 8 — Pipeline value, win
  rate, MRR/ARR, and the rest of Section 21 once the domain modules that
  feed them exist." The domain modules now all exist.
- [ADR 0004](0004-sales-phase4-scope.md): "Section 36 dedicates all of Phase
  8 ('Analytics & Automation') to 'Dashboards, Reports... Forecasting'."
- [ADR 0005](0005-quotations-phase5-scope.md) decision #9: accepting a quote
  deliberately does not auto-advance its linked Opportunity's stage —
  "ADR 0004 already pushed this class of automation ('deeper...
  automation') to Phase 8; this is the same call applied here, not a
  silently-dropped feature." Quotes already carried a nullable
  `opportunityId` FK, unused until now.
- `docs/plans/0003-phase3-leads-plan.md`: "No fuzzy matching — that's
  Phase 8 'Advanced search' territory" and "Leads are not added to Phase
  2's `SearchService`... §36 places 'Advanced search' in Phase 8."

So Phase 8 is three named, separable pieces: cross-entity analytics, one
concrete automation, and advanced search. Nothing else has a breadcrumb
pointing at Phase 8 — in particular `notifications` (named in ADR 0001's
aspirational module list, still zero implementation anywhere) has no phase
assignment and no UI/infra hint of its shape.

## Decisions

**1. Three pieces, each a disciplined increment: Analytics, one Automation, Advanced Search — nothing else.**
No `notifications` module, no fuzzy duplicate-detection upgrade, no
multi-widget BI suite beyond the named metrics. Every included piece has a
direct quote pointing at Phase 8; nothing else does.

**2. Analytics is a new top-level `apps/api/src/modules/analytics/` module reading other domains' schemas directly, not via service injection.**
`AnalyticsService.dashboard()` queries `sales.opportunities` and
`subscriptions.subscriptions` directly with raw Drizzle queries, the same
"direct cross-schema reads, no cross-module service DI" precedent
Quotes/Support/Subscriptions already established for reading
`crm.accounts`/`crm.contacts` — applied here for the first time across two
already-built top-level domains instead of into a shared one. A few lines
of duplicated win-rate arithmetic (already computed once in
`OpportunitiesService.summaryStats`) is cheaper than a new cross-domain DI
edge.

**3. Dashboard metrics are exactly 7 fields**, matching the placeholder
card's own wording: `openPipelineValue`, `weightedPipelineValue`,
`winRate`, `openOpportunitiesCount`, `mrr`, `arr`, `activeSubscriptionsCount`.
MRR sums active subscriptions' snapshotted price, normalizing yearly plans
to monthly (÷ 12); ARR = MRR × 12. A fuller BI dashboard (funnel charts,
revenue-over-time, ticket stats) isn't named anywhere in the brief's
breadcrumbs and stays a deferral, not a silent gap.

**4. A new permission family, `analytics.view`, granted to Member by default.**
No `analytics.*` namespace was pre-reserved in `permissions.ts` (unlike
`subscriptions.*` since Phase 1) — the first phase needing a genuinely new
permission family rather than narrowing a reserved one. Granting it to
Member matches today's behavior, where the placeholder dashboard card was
visible to every authenticated user with no gate at all.

**5. The automation lives inside Sales, as an event listener — not inside Quotes, and not via Quotes calling into Sales' services.**
`QuotesService.acceptByToken`'s existing `quote.accepted` publish gained one
field, `opportunityId`. A new `QuoteAcceptedListener`
(`apps/api/src/modules/sales/automation/quote-accepted.listener.ts`,
`@OnEvent("quote.accepted")`) lives in `SalesModule`, which already exports
`OpportunitiesService`/`PipelinesService` — no new cross-module wiring
beyond registering the listener as a provider. This is the same concern
ADR 0005 decision #9 raised (Quotes doing a live lookup into Sales'
pipeline/stage internals to save one manual click) — solved this time by
inverting the dependency: Sales reacts to an event Quotes already
publishes, so Quotes still knows nothing about Sales.

**6. The automation reuses `moveStage`'s exact semantics via small, dedicated methods rather than loosening `moveStage`'s own signature.**
`PipelinesService.findWinStage(organizationId, pipelineId)` returns the
first `isWon` stage of a pipeline, or `undefined` — a normal, silently
handled outcome for the caller, not an error, since org-defined pipelines
aren't required to have a win stage.
`OpportunitiesService.autoAdvanceOnQuoteAccepted(organizationId,
opportunityId)` no-ops if the opportunity is already closed or its
pipeline has no win stage; otherwise it performs the same field-set update
`moveStage` performs and publishes the same `opportunity.stage_changed`/
`opportunity.won` events `moveStage` already publishes when a stage move
lands on a win stage — so a manual and an automated stage move look
identical on the account timeline, with zero Timeline changes required.
`updatedBy`/`actorId` are left unset (system-originated write), the same
precedent `SubscriptionsService.lapseIfDue()` already set.

**7. The listener is best-effort: caught and logged, never thrown back into the request path.**
Quote acceptance is a public, unauthenticated, token-based action and must
succeed regardless of whether the automation runs — the same posture
`MailListener`/`AuditListener` already use everywhere.

**8. Advanced search adds `pg_trgm` fuzzy ranking to the existing `SearchService`, and onboards Leads as a third searchable type.**
Each per-type query's `WHERE` clause gained `OR <name-expr> % :q`
(trigram similarity operator) alongside the existing `tsvector` match, and
its rank became `GREATEST(ts_rank(...), similarity(<name-expr>, :q))`.
Leads got the same generated-`tsvector`-column treatment
`crm.accounts`/`crm.contacts` already have (weight A: `name`, weight B:
`company`) plus a trigram GIN index, via a hand-written migration
(`0008_yellow_gunslinger.sql`) — the same "declare a plain `text`
placeholder column in Drizzle, hand-write the real generated-column SQL and
any GIN indexes that Drizzle can't express" technique already used twice
for `crm.accounts`/`crm.contacts`. `pg_trgm` is a built-in Postgres
extension, not new infrastructure — consistent with ADR 0001's "avoid new
infra unless a concrete need forces it" discipline. `SearchResultDto.type`
gained `"lead"`; `SearchController` gates it behind `leads.view`, silently
excluding (not 403ing) a caller without it, the same behavior already used
for account/contact.

**9. No new frontend surface for Leads-in-search.**
The one existing consumer, `apps/web/src/hooks/use-search.ts` (used only by
the Accounts page's inline typeahead), keeps its default (`types` omitted →
account+contact only) so that page's behavior is unchanged. `"lead"` is a
valid, permission-gated `types` value on the API from day one, ready for a
future consumer — no global command-palette or search page exists anywhere
in the frontend to extend, and inventing one would be scope creep unrelated
to any named Phase 8 item. The mirror image of Phase 7's "renewal history
not surfaced as an endpoint" deferral: backend built ahead of any frontend
need for it.

**10. `notifications` stays explicitly out of scope, still just reserved.**
No in-app notification concept (bell icon, unread state, delivery
preferences) exists anywhere in the frontend or API today, and no ADR or
stub assigns it to Phase 8 specifically — only ADR 0001's aspirational
module list names it, with no phase attached. Recorded here so it isn't
silently forgotten, distinct from the three items that do have a Phase 8
breadcrumb.

## Consequences

- The dashboard home page now shows real, live pipeline/MRR/ARR numbers
  instead of a "Sales metrics — Arrives in Phase 8" placeholder.
- Accepting a quote linked to an Opportunity automatically closes that
  Opportunity as Won — the one Phase 8 automation the brief named
  concretely. No other cross-module automation was added; further
  automations (e.g. lead-scoring-driven actions, ticket-driven workflows)
  remain future scope, not silently dropped.
- Global search now tolerates typos and can include Leads when explicitly
  requested via `types=lead` — the Accounts page's existing typeahead is
  unaffected since it never opts into the `lead` type.
- `notifications` (in-app notification center) remains unbuilt, reserved
  only in ADR 0001's module list, with no phase assignment — a future ADR
  should scope it explicitly rather than it arriving as a side effect of
  another phase.
