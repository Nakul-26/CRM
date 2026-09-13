# ADR 0020: Lead search frontend surface — Phase 20 scope

## Status

Accepted — 2026-09-05

## Context

[ADR 0008](0008-analytics-automation-phase8-scope.md) (Phase 8) added
`pg_trgm` fuzzy ranking to `SearchService` and onboarded Leads as a third
searchable type (`GET /search?types=account,contact,lead`, gated on
`leads.view`), but its decision #9 explicitly recorded a deliberate cut:
*"No new frontend surface for Leads-in-search. The one existing consumer,
`apps/web/src/hooks/use-search.ts` (used only by the Accounts page's inline
typeahead), keeps its default (`types` omitted → account + contact)... a
deliberate backend-ahead-of-frontend cut, recorded rather than silently
left half-built."*

This phase was chosen directly by the user from two candidate deferred
features, after Phase 19 (notification preferences + email digest) was
completed and committed. It closes exactly the gap ADR 0008 named — nothing
more.

## Decisions

**1. Extend the existing Accounts-page typeahead, not a new dedicated
search page.** `use-search.ts` is still the only frontend consumer of
`GET /search`; a standalone "Leads search" page would duplicate that
surface for no evidenced need ADR 0008 didn't already anticipate and
explicitly deferred past. Same "smallest change that satisfies the
deferral" discipline used throughout this project.

**2. Gated on `leads.view`, matching the backend's own gate exactly.**
`SearchController` already silently excludes a requested type the caller
lacks permission for rather than 403ing. The frontend now makes the same
call before it ever asks: `useSearch(query, canViewLeads ? ["account",
"contact", "lead"] : undefined)`. A user without `leads.view` sees
byte-for-byte today's behavior (`types` omitted, server default applies) —
this phase changes nothing for them.

**3. `useSearch` gained an optional `types` parameter, not a new hook.**
The query key now includes the resolved `types` list so an account-only
cache entry and an account+contact+lead cache entry for the same query text
don't collide in React Query's cache. Omitting the parameter (every
pre-existing call site outside the Accounts page, if any were added later)
is unchanged.

**4. A lead result links straight to `/leads/${id}`, not a list.** Leads
have a real detail page (`apps/web/src/app/(dashboard)/leads/[id]/page.tsx`)
— unlike Contacts, which only have a list page today and so a contact
result links to `/crm/contacts`. Each result type links to the most
specific real page that exists for it.

**5. No backend change.** `SearchService`, `SearchController`, and the
`SearchResultDto` contract (already `"account" | "contact" | "lead"`) were
correct and complete since Phase 8. This phase is a frontend-only diff.

**6. Verified via typecheck/build, not a new automated test.** No frontend
test infrastructure exists anywhere in this repo (`apps/web` has no test
script, no `.test.`/`.spec.` files) — a pre-existing gap, not one
introduced here. As with prior frontend-only changes (e.g. Phase 19's
notification settings page), this phase is verified by `pnpm typecheck` +
`pnpm build` passing and a full read-through of the diff; no browser
automation is available in this environment to click through the actual
typeahead. The one backend contract this phase now actually exercises from
the frontend (`types=lead`, RBAC-gated) already has e2e coverage from Phase
8 (`crm-search.e2e-spec.ts`), re-run here as a sanity check, unchanged.

## Consequences

- A user with `leads.view` typing into the Accounts page's search box now
  sees matching Leads alongside Accounts/Contacts, and can click straight
  through to that lead's detail page.
- The "no new frontend surface for Leads-in-search" item ADR 0008 deferred
  is now resolved; `docs/architecture/overview.md`'s deferred-items table
  reflects that.
- The whole-repo "no frontend automated test infrastructure" gap remains
  open — this phase doesn't close it, and doesn't need to: it's the same
  pre-existing condition every prior frontend-only phase has already
  noted, not something newly introduced here.
