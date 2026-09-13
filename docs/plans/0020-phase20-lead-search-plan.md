# Phase 20 — Lead search frontend surface

## Context

This feature was chosen directly by the user from two candidate deferred
features, after Phase 19 (notification preferences + email digest) was
completed and committed as `97aefb5`.

[ADR 0008](../decisions/0008-analytics-automation-phase8-scope.md) (Phase
8) added `pg_trgm` fuzzy ranking and onboarded Leads as a third searchable
type in the backend `SearchService`/`SearchController`
(`GET /search?types=account,contact,lead`, gated on `leads.view`), but its
decision #9 explicitly recorded: *"No new frontend surface for Leads-in-
search... a deliberate backend-ahead-of-frontend cut, recorded rather than
silently left half-built."* `docs/architecture/overview.md`'s deferred-items
table still listed this as open.

Goal: close that specific, named gap — let the existing search surface
return and link to Lead results for a user who can see them — without
inventing a new dedicated search page or touching the backend, which
already does everything needed.

## Scope decisions

- **Extend the existing Accounts-page typeahead**, not a new page — same
  "smallest change that satisfies the deferral" discipline as every prior
  phase.
- **Gated on `leads.view`**, matching the backend's own silent-exclusion
  gate exactly.
- **No backend change** — `SearchService`/`SearchController`/
  `SearchResultDto` were already correct and complete since Phase 8.
- **A lead result links to `/leads/${id}`** (a real detail page exists),
  unlike a contact result (list-only, no contact detail page exists).

See [ADR 0020](../decisions/0020-lead-search-frontend-phase20-scope.md) for
the full decision record.

## Implementation

**`apps/web/src/hooks/use-search.ts`**: `useSearch(query, types?)` gained an
optional `types?: ("account" | "contact" | "lead")[]` second parameter,
appended as `&types=a,b,c` when provided and folded into the React Query
`queryKey`. Omitted, the call is byte-for-byte unchanged from before this
phase.

**`apps/web/src/app/(dashboard)/crm/accounts/page.tsx`**:
- `canViewLeads = currentUser?.permissions.includes("leads.view")`, next to
  the existing `canCreate`/`canDelete` checks.
- `useSearch(query, canViewLeads ? ["account", "contact", "lead"] : undefined)`.
- Result link: `account` → `/crm/accounts/${id}`, `lead` → `/leads/${id}`,
  else (`contact`) → `/crm/contacts`.
- Placeholder text reflects what's actually searched, conditional on
  `canViewLeads`.

## Testing

No new automated test — no frontend test infrastructure exists in this
repo (pre-existing, not introduced by this phase; see ADR 0020 decision
#6). Verified via `pnpm typecheck` + `pnpm build` and a full diff
read-through. The backend contract this phase now exercises from the
frontend (`types=lead`, RBAC-gated) already has e2e coverage from Phase 8
(`apps/api/test/crm-search.e2e-spec.ts`); re-run as a sanity check, no
changes made to it.

## Docs

- [ADR 0020](../decisions/0020-lead-search-frontend-phase20-scope.md).
- This plan, persisted.
- `docs/architecture/overview.md` — deferred-items table row resolved; new
  "Phase 20 scope" section.
- `README.md` — Phase 20 marked current.

## Verification

1. `pnpm typecheck` (monorepo-wide) — clean, including the new `useSearch`
   signature and updated JSX.
2. `pnpm build` (monorepo-wide) — Next.js production build succeeds.
3. `apps/api/test/crm-search.e2e-spec.ts` re-run alone — green, unchanged
   (no backend files touched).
4. Full existing `apps/api` unit + e2e suites re-run — no regression
   (nothing in this phase touches backend code, so this is a sanity check,
   not an expectation of finding anything).

### Verification findings

Full unit suite: 26/26 suites, 145/145 tests, clean. `crm-search.e2e-spec.ts`
(the exact backend contract this phase's frontend change now exercises,
`types=lead` included) run in isolation: 4/4 green. `pnpm typecheck` (9/9)
and `pnpm build` (6/6, including a real Next.js production build listing
`/crm/accounts` and every other route) both clean.

A full e2e re-run (33 suites) surfaced 6 failing tests across 3 suites:
`search-opensearch.e2e-spec.ts`, `oidc-login.e2e-spec.ts`, and
`crm-timeline.e2e-spec.ts` — none of which this phase's diff touches (this
phase changed exactly two frontend files plus docs; `git status` confirmed
no other file changed). Isolation reruns showed `crm-timeline.e2e-spec.ts`
pass cleanly on retry (a one-off ordering flake, consistent with this
project's established fire-and-forget-listener timing pattern), while
`search-opensearch.e2e-spec.ts` and `oidc-login.e2e-spec.ts` failed
consistently even run alone, despite both OpenSearch (`curl
localhost:9201/_cluster/health` → `"status":"green"`) and Keycloak
(`docker ps` → both containers "healthy") reporting fine. A process check
(`Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"`) found dozens
of unrelated Node dev processes already running on this machine (several
duplicated `wrangler dev`/`next dev`/`turbo run dev`/`tsx watch` stacks from
other, unrelated projects), representing sustained, unrelated system-wide
CPU/memory contention — squarely explaining why two tests whose assertions
depend on real external round-trips finishing inside a fixed wall-clock
budget (a 10s OpenSearch index-refresh poll, a 30s Keycloak token exchange)
would time out, with no code-level cause. Not chased further: killing
another project's dev servers to get a clean signal wasn't this phase's
call to make, and neither failing suite's subsystem (OpenSearch indexing,
Keycloak OIDC) has any relationship to this phase's search-frontend-only
diff.

### Critical files
- `apps/web/src/hooks/use-search.ts` (existing) — optional `types` param
- `apps/web/src/app/(dashboard)/crm/accounts/page.tsx` (existing) —
  leads.view gate, link, placeholder
- `docs/decisions/0020-lead-search-frontend-phase20-scope.md` (new)
