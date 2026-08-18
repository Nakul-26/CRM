# Phase 10 — Audit Log UI

## Context

The audit trail itself has existed since Phase 1: `AuditListener`
(`apps/api/src/shared/audit/audit.listener.ts`) writes every domain event to
the `identity.audit_log` table automatically, and the permission
`audit.log.view` has been reserved since Phase 1 (already granted to Owner
and Admin via `SYSTEM_ROLE_PERMISSIONS`, `packages/contracts/src/permissions.ts`)
and already wired into the nav (`apps/web/src/lib/nav.ts:81`, pointing at
`/administration/audit`). What's missing is the read side: no controller
anywhere queries `audit_log`, and the page is still a `ComingSoon` stub
(`apps/web/src/app/(dashboard)/administration/audit/page.tsx`). This was the
runner-up candidate when Phase 9's scope was chosen, and you've now picked it
to close out. No new permission, no new event types, no schema change — this
phase is additive read-only surface over data that already exists.

## 0. Scope decisions

| Decision | Reasoning |
|---|---|
| **New submodule `apps/api/src/modules/identity/audit/`** (controller + service), registered in the existing `IdentityModule`. No new top-level module, no new schema. | `audit_log` already lives in the `identity` Postgres schema; the nav groups "Audit Log" under Administration alongside Users/Teams/Roles, which are all `identity` submodules today. Matches existing module boundaries exactly. |
| **One endpoint: `GET /audit-log`**, filters via plain `@Query()` string params (`eventType`, `actorId`, `dateFrom`, `dateTo`), `limit`/`offset` pagination, response `{ items: AuditLogEntryDto[]; total: number }`. | Matches the `tickets.controller.ts` plain-`@Query()` filter style exactly (no Zod DTO for GET filters is the established convention). Pagination is new — no endpoint in the app paginates today — but justified here specifically: `audit_log` grows forever (every domain event, unbounded), unlike every other list which is bounded by real-world cardinality (tickets, accounts, etc. don't grow without a human creating each row 1:1). Documented as a new-but-justified pattern, same treatment Phase 9 gave user-scoping. Default `limit=50`, max `limit=200`. |
| **`eventType` filter is exact-match; `actorId` exact-match; `dateFrom`/`dateTo` filter `createdAt` via Drizzle `gte`/`lte`.** No full-text/payload search. | No combined "all event types" export exists in `packages/contracts/src/events.ts` (only per-domain arrays) and building one is unjustified scope for a filter dropdown — a plain text input (exact match) is enough and avoids inventing a new contracts export. Date-range filtering is a new pattern in this app (grepped — no precedent) but is a straightforward, low-risk use of Drizzle's existing `gte`/`lte`, same as the `and(...conditions)` conditional-array style already used in `tickets.service.ts`. |
| **Response rows join `users` via `leftJoin` (not inner join) to attach `actorName`/`actorEmail`.** `actorId` is nullable (system-triggered events, e.g. Phase 7's renewal reminders and Phase 8's auto-advance automation, have no actor) — those rows must still appear, with `actorName: null`. | Matches `users.service.ts`'s `listForOrganization` `leftJoin` pattern; nullability is a real, already-proven case (not hypothetical), so `leftJoin` is required, not optional. |
| **No new permission.** Reuse `audit.log.view` (`@RequirePermissions("audit.log.view")` on the controller), already seeded to Owner/Admin. | It's existed since Phase 1 specifically for this UI — using anything else would be new, unjustified scope. |
| **Frontend: replace the `ComingSoon` stub with a real page** using the existing `DataTable` component (`apps/web/src/components/ui/data-table.tsx`), filters as plain native `<select>`/`<input type="date">`/`<input type="text">` bound to `useState` (same as `tickets/page.tsx`), a "Prev/Next" pager (first paginated UI in the app, backed by the new `limit`/`offset` params), and a "View details" action per row opening the existing `Dialog` component to pretty-print the row's raw JSON `payload`. | Every element reuses an existing primitive — `DataTable`, native form controls (no date-picker component exists in the repo, `type="date"` input is the established precedent from `quote-form.tsx:165`), `Dialog`. No new UI component library surface introduced. |
| **Not built:** payload full-text search, CSV/export, retention/archival policy, real-time streaming of new audit rows. | Recorded explicitly as a deferral, same discipline every prior ADR in this repo has followed — none of these have any evidence of being needed yet. |

---

## 1. Contracts

`packages/contracts/src/audit.ts` (new):
```ts
export interface AuditLogEntryDto {
  id: string;
  eventType: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  payload: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditLogPageDto {
  items: AuditLogEntryDto[];
  total: number;
}
```
Export from `packages/contracts/src/index.ts`. No new Zod input schema — GET-only, filters are plain query params (matches `tickets` convention).

---

## 2. Backend

`apps/api/src/modules/identity/audit/audit.service.ts` (new):
- `list(organizationId, { eventType?, actorId?, dateFrom?, dateTo?, limit, offset })`:
  - `conditions = [eq(auditLog.organizationId, organizationId)]`, conditionally push `eq(auditLog.eventType, ...)`, `eq(auditLog.actorId, ...)`, `gte(auditLog.createdAt, dateFrom)`, `lte(auditLog.createdAt, dateTo)` — same conditional-array-into-`and()` style as `tickets.service.ts`.
  - `select({ ...auditLog columns, actorName: users.fullName, actorEmail: users.email }).from(auditLog).leftJoin(users, eq(auditLog.actorId, users.id)).where(and(...conditions)).orderBy(desc(auditLog.createdAt)).limit(limit).offset(offset)`.
  - Separate `select({ count: count() }).from(auditLog).where(and(...conditions))` for `total` (same two-query count+page pattern, no existing precedent to match but it's the standard Drizzle idiom).

`apps/api/src/modules/identity/audit/audit.controller.ts` (new):
- `@Controller("audit-log")`, `@RequirePermissions("audit.log.view")`.
- `GET /` — `@Query("eventType") @Query("actorId") @Query("dateFrom") @Query("dateTo") @Query("limit") @Query("offset")`, parse/clamp `limit` (default 50, max 200) and `offset` (default 0) as numbers, call service, return `AuditLogPageDto`.

Register `AuditController`/`AuditService` in the existing `apps/api/src/modules/identity/identity.module.ts` (alongside Users/Teams/Roles — confirm exact existing registration style there and follow it).

**Route table (new only):**

| Method | Path | Auth |
|---|---|---|
| GET | `/audit-log` | `audit.log.view` |

---

## 3. e2e testing

New `apps/api/test/audit-log.e2e-spec.ts`:
- Register an org (which itself publishes `organization.registered`/`user.registered`-type events) → `GET /audit-log` as Owner returns rows including those bootstrap events.
- Perform a handful of varied actions (create an account, create+assign a ticket) → confirm corresponding `eventType`s appear, and the assigning user's `actorName`/`actorEmail` are populated via the join.
- Filter by `eventType` → only matching rows returned. Filter by `actorId` → only that actor's rows. Filter by `dateFrom`/`dateTo` → excludes rows outside the range (use a wide range including "now" vs. a `dateFrom` in the future to prove exclusion).
- Pagination: create > `limit` rows worth of events (or set a small `limit` param), confirm `items.length <= limit`, `total` reflects the full count, and `offset` moves the window (no overlap/gap at the boundary).
- A system-triggered event with no actor (reuse Phase 8's `autoAdvanceOnQuoteAccepted` path — accept a quote linked to an opportunity via the public token) still appears in the log with `actorId: null`, `actorName: null`.
- Cross-tenant isolation: a second org's audit rows never appear.
- Permission gate: a user without `audit.log.view` (e.g. default Member role) gets 403; unauthenticated gets 401.

Re-run the full e2e suite to confirm no regressions (the new join/controller touches nothing existing).

---

## 4. Frontend

`apps/web/src/hooks/use-audit-log.ts` (new) — `useAuditLog({ eventType?, actorId?, dateFrom?, dateTo?, limit, offset })`, standard TanStack Query hook returning `AuditLogPageDto`, matching every other list hook's shape.

`apps/web/src/app/(dashboard)/administration/audit/page.tsx` (replace stub) —
- Filter row: text input for `eventType`, text input for `actorId` (or a `<select>` populated from the org's users if a `useUsers()` hook already exists for that — reuse it rather than a raw text input if it does), two `<input type="date">` for `dateFrom`/`dateTo`.
- `DataTable` columns: timestamp (`createdAt`, localized), event type, actor (`actorName ?? "System"`), a "View" button per row.
- "View" opens the existing `Dialog` component showing the row's `payload` pretty-printed (`JSON.stringify(payload, null, 2)` in a `<pre>`), plus `ip`/`userAgent`/`requestId`/`correlationId` if present.
- Prev/Next buttons adjusting `offset` by `limit`, disabled appropriately at the start/end using `total`.

---

## 5. Sequencing checkpoints (system stays runnable + tested after each)

**A — Backend.** Contract file + barrel export; `audit.service.ts` + `audit.controller.ts`; register in `identity.module.ts`; `audit-log.e2e-spec.ts`.
*Verify: new spec green; full e2e suite unaffected (`pnpm --filter @sales-platform/api test:e2e`).*

**B — Frontend.** `use-audit-log.ts`; replace the `ComingSoon` stub with the real page.
*Verify manually via isolated dev instances (same port convention as Phase 9: alternate ports, existing foreign/stale processes on 3000/3004 left untouched)*: log in as Owner, confirm the table populates with real historical events from prior phases' data, exercise each filter individually, confirm pagination Prev/Next works, open "View details" and confirm the JSON payload renders.

**C — Docs.** `docs/decisions/0010-audit-log-ui-phase10-scope.md` (new ADR, codifying every §0 row); `docs/plans/0010-phase10-audit-log-plan.md` (this plan, persisted); `docs/architecture/overview.md` (module list note; new "Phase 10 scope" section; note in the deferred-tech table area that the Audit Log UI is no longer a stub); `README.md` (Phase 10 marked current, feature summary, mirroring Phase 9's paragraph style). Full unit + e2e suite, both builds — final gate.

---

## Verification

- After A: e2e green (new spec + full existing suite, unit tests unaffected since no unit-testable pure logic is introduced here).
- After B: manual smoke test via `pnpm dev` on isolated ports — filters, pagination, and payload detail view all confirmed against real data.
- `pnpm --filter @sales-platform/api build` and `pnpm --filter @sales-platform/web build` clean, final gate.

### Critical files
- `apps/api/src/modules/identity/audit/audit.service.ts` (new) — filtered/paginated query + join
- `apps/api/src/modules/identity/audit/audit.controller.ts` (new) — the one new route
- `apps/api/src/modules/identity/identity.module.ts` (existing) — registers the new submodule
- `apps/api/src/database/schema/identity.schema.ts` (existing, read-only) — `auditLog` table already defined here, no changes needed
- `apps/web/src/app/(dashboard)/administration/audit/page.tsx` (replace stub) — the UI
- `apps/web/src/hooks/use-audit-log.ts` (new)
- `packages/contracts/src/audit.ts` (new) — `AuditLogEntryDto`/`AuditLogPageDto`
