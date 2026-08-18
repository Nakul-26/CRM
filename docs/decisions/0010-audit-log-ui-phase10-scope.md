# ADR 0010: Audit Log UI Phase 10 scope — read-only surface over an already-existing trail

## Status

Accepted — 2026-08-18

## Context

The audit trail itself has existed since Phase 1: `AuditListener`
(`apps/api/src/shared/audit/audit.listener.ts`) writes every domain event to
the `identity.audit_log` table automatically, and the `audit.log.view`
permission has been reserved since Phase 1 (already granted to Owner and
Admin via `SYSTEM_ROLE_PERMISSIONS`) and already wired into the nav
(`apps/web/src/lib/nav.ts`, pointing at `/administration/audit`). What was
missing was the read side — no controller anywhere queried `audit_log`, and
the page was still a `ComingSoon` stub. This was the runner-up candidate
offered alongside Notifications when [ADR 0009](0009-notifications-phase9-scope.md)'s
scope was chosen; the user has now picked it to close out. No new
permission, no new event types, no schema change — this phase is additive
read-only surface over data that already existed.

## Decisions

**1. A new submodule `apps/api/src/modules/identity/audit/`** (controller +
service), registered in the existing `IdentityModule`. No new top-level
module, no new schema.
`audit_log` already lives in the `identity` Postgres schema, and the nav
groups "Audit Log" under Administration alongside Users/Teams/Roles — all
`identity` submodules today. This matches existing module boundaries
exactly rather than inventing a new top-level module for one table that's
already owned elsewhere.

**2. One endpoint, `GET /audit-log`, with `limit`/`offset` pagination — the
first paginated endpoint in the app.**
Filters are plain `@Query()` string params (`eventType`, `actorId`,
`dateFrom`, `dateTo`), matching `tickets.controller.ts`'s established
GET-filter style exactly (no Zod DTO for query params). Pagination itself is
new — no endpoint in the app paginates today — but justified specifically
here: `audit_log` grows forever (one row per domain event, unbounded),
unlike every other list in the app which is bounded by real-world
cardinality (a human creates each ticket/account/etc. roughly 1:1).
Default `limit=50`, max `limit=200`, response is `{ items, total }`.
Recorded here as a new-but-justified pattern, the same treatment ADR 0009
gave user-scoped (rather than org-scoped) queries.

**3. `eventType`/`actorId` filters are exact-match; `dateFrom`/`dateTo`
filter `createdAt` via Drizzle `gte`/`lte`. No payload search.**
`packages/contracts/src/events.ts` has no combined "all event types" export
(only per-domain arrays), and building one solely to populate a filter
dropdown was rejected as unjustified scope — a plain text input is enough.
Date-range filtering has no precedent elsewhere in the app but is a
straightforward use of Drizzle's existing `gte`/`lte`, following the same
conditional-array-into-`and(...)` style `tickets.service.ts` already uses.

**4. Rows join `users` via `leftJoin`, not an inner join, to attach
`actorName`/`actorEmail`.**
`actorId` is nullable — system-triggered events (Phase 7's renewal
reminders, Phase 8's `autoAdvanceOnQuoteAccepted`) publish with no actor —
and those rows must still appear, with `actorName: null`. Matches
`UsersService.listForOrganization`'s `leftJoin` pattern; the nullable case
is proven, not hypothetical, so `leftJoin` is required here, not optional.

**5. No new permission.** Reuses `audit.log.view`, reserved since Phase 1
specifically for this UI and already seeded to Owner/Admin.

**6. Frontend replaces the `ComingSoon` stub, reusing only existing
primitives.**
`DataTable` for the row list, native `<select>`/`<input type="date">`/
`<input type="text">` filters bound to `useState` (matching
`tickets/page.tsx`'s filter style — no date-picker component exists
anywhere in the repo, `type="date"` is the established precedent from
`quote-form.tsx`), the existing `Dialog` component for a "View details"
panel that pretty-prints the row's raw JSON `payload`, and a Prev/Next
pager — the first paginated UI in the app, backed by the new `limit`/
`offset` params.

**7. Not built:** payload full-text search, CSV/export, a retention/
archival policy, real-time streaming of new audit rows. Recorded explicitly
as a deferral — the same "record every cut, don't silently build or
silently skip" discipline every prior ADR here has followed; none of these
have any evidence of being needed yet.

## Consequences

- Anyone with `audit.log.view` (Owner/Admin by default) can now see and
  filter the organization's full audit trail from the dashboard, not just
  query it indirectly via raw database access.
- The app's first paginated endpoint and first paginated UI exist now —
  future lists that outgrow a flat/capped query have a precedent to follow.
- The runner-up candidate from ADR 0009 is now resolved — no open,
  evidenced-but-unbuilt items remain from that original list.
