# Phase 2 — CRM Implementation Plan

> Implemented as of 2026-08-15. Kept as a record of the design decisions
> behind Phase 2 — see [docs/architecture/overview.md](../architecture/overview.md)
> for the current-state description and [ADR 0002](../decisions/0002-crm-phase2-scope.md)
> for what was deliberately left out.

## Context

Phase 1 (Identity & Access) is built, tested, and running: organizations,
users, teams, roles/permissions, JWT auth, tenant isolation, audit logging —
all as a NestJS modular monolith (`apps/api`) + Next.js BFF (`apps/web`),
per `docs/decisions/0001-modular-monolith.md`. The product brief's own
phased plan (Section 36) calls for **Phase 2 — CRM** next: Accounts,
Contacts, Activities, Customer timeline, Search, RBAC, Audit (Section 6 has
the detailed feature list).

Goal: extend the existing monolith with a new `crm` schema-owning module,
following Phase 1's conventions exactly, so the system stays runnable and
fully tested after each checkpoint.

---

## 0. Scope decisions

| Sub-feature | Decision | Reasoning |
|---|---|---|
| **Documents** (file uploads on accounts) | **Defer.** Recorded in [ADR 0002](../decisions/0002-crm-phase2-scope.md). | Needs file storage + virus scanning (brief §27) — a phase of its own; nothing else in Phase 2 depends on it. |
| **Custom fields** (dynamic schema) | **Defer**, same ADR. | Dynamic field storage + a field-builder UI is a standalone feature; building it half-heartedly now would need a rewrite later. Ship fixed, well-designed columns now. |
| **Account "Notes"** | No separate `notes` column. Notes are `activities` rows with `type = "note"`. | The brief lists Notes under both Accounts *and* the Activity Timeline — one model, one place, appears on the timeline for free. |
| **Contact → Account cardinality** | One contact belongs to at most one account (`accountId` nullable FK). | Matches the brief's tree diagram; nullable because a contact may exist pre-qualification with no employer yet. |
| **Tags** | `jsonb` string array on `accounts`/`contacts`, not a separate table. | No tag metadata/reuse requirement exists yet; precedent: `roles.permissions` is already `jsonb.$type<string[]>()`. Revisit only if tag management becomes a real requirement. |
| **Billing/shipping address** | `jsonb` structured column (`Address` type), not flat columns. | Both are single optional blobs with the same shape; nothing queries by address field today. |
| **Company size** | `text`, validated via a zod enum, not a Postgres enum type. | No `pgEnum` used anywhere in the existing schema — stay consistent; a zod union is cheaper to extend than a Postgres enum migration. |
| **Soft delete** | Implement it for real: `deletedAt` set on delete, all reads filter `isNull(deletedAt)`. | `identity.users.deletedAt` exists but is dead code (`deactivate()` only sets `isActive=false`). Accounts/contacts are referenced by activities and later by opportunities/quotes/tickets, so hard-delete would orphan or block on FK — soft delete avoids that. |
| **Search backend** | Postgres `tsvector` + GIN index, not `ILIKE`. | Per ADR 0001, Postgres FTS is the already-accepted plan through Phase 7 (OpenSearch deferred). `ILIKE '%term%'` can't use an index. |

---

## 1. Data model

`apps/api/src/database/schema/crm.schema.ts`, `pgSchema("crm")`: `accounts`,
`contacts`, `activities` tables + `relations()`, following
`identity.schema.ts`'s conventions (`id: uuid().primaryKey().$defaultFn(...)`,
`organizationId` FK cascade, timestamptz `createdAt`/`updatedAt`
defaultNow(), indexes per table).

**tsvector search columns**: after `drizzle-kit generate` produces the base
table SQL, the migration is hand-edited to add:

```sql
"search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(industry,'') || ' ' || coalesce(website,'')), 'B')
) STORED;
CREATE INDEX accounts_search_idx ON "crm"."accounts" USING GIN (search_vector);
-- equivalent for contacts: weight A on first_name||' '||last_name, weight B on email/job_title
```

`GENERATED ALWAYS ... STORED` means Postgres maintains it automatically —
no app code updates it on write. Same migration also adds
`audit_log_org_type_created_idx` on `identity.audit_log
(organization_id, event_type, created_at)`, needed for the timeline query
in §2 to stay fast.

---

## 2. Timeline design

**Principle**: the timeline is a read-time merge of independent sources,
not a table of its own — this is what makes it extensible for Phase 4+
(opportunities/quotes/subscriptions/tickets) without a rewrite.

**Sources merged**:
1. `crm.activities` rows for the account (directly, or via its contacts).
2. `identity.audit_log` rows where `organizationId` matches, `eventType` is
   in an allowlist (`TIMELINE_EVENT_TYPES`), and `payload->>'accountId'`
   (or `payload->>'contactId'` resolving to this account) matches.

**Wiring**:
- `AccountsService`/`ContactsService` publish `account.created/updated/deleted`,
  `contact.created/updated/deleted` via the existing `DomainEventBus`, with
  `payload.accountId` always set. These land in `audit_log` automatically
  via the existing wildcard listener — no new plumbing needed.
- `packages/contracts/src/events.ts` has `CRM_EVENT_TYPES` (full set) and
  `TIMELINE_EVENT_TYPES` (the subset fit for a customer-facing timeline).
  **This constant is the one place Phase 4+ touches to slot new modules
  into the timeline** — everything else is generic over "any event with an
  accountId/contactId in its payload."
- `TimelineService.forAccount()`: confirm the account exists in-org (404
  otherwise), query activities + audit_log independently, normalize both
  into one `TimelineEntryDto` shape, merge, sort by `occurredAt` desc.
  Done as an application-level merge (two queries + in-memory sort), not a
  cross-schema SQL `UNION` — shapes differ enough that normalizing in TS is
  clearer, and volumes are tiny at this stage.

Endpoint: `GET /accounts/:id/timeline`.

---

## 3. Search design

`apps/api/src/modules/crm/search/` (service + controller), spanning both
accounts and contacts.

- `plainto_tsquery('english', :q)` matched against each table's
  `search_vector` via `@@`, ranked with `ts_rank`, results from both tables
  combined and sorted by rank. Drizzle's query builder has no `@@`/`tsquery`
  operator support, so this query is raw SQL via `db.execute(sql\`...\`)`
  — the one deliberate escape hatch in an otherwise query-builder codebase.
- Endpoint: `GET /search?q=&types=account,contact&limit=20` →
  `SearchResultDto[]`.
- Permission handling: if the caller lacks `crm.accounts.view` or
  `crm.contacts.view`, silently exclude that type from results rather than
  403ing the whole search.

---

## 4. API surface

**New permissions** added to `packages/contracts/src/permissions.ts`:
```
crm.contacts.view/create/edit/delete
crm.activities.view/create/edit/delete
```
`SYSTEM_ROLE_PERMISSIONS.Member` gained `crm.accounts.create/edit`,
`crm.contacts.view/create/edit`, `crm.activities.view/create/edit`.
`*.delete` stays Admin/Owner-only. **Known limitation, not fixed in this
phase**: orgs registered before this shipped won't retroactively get these
permissions on their seeded Member role (`seedSystemRoles` only runs once,
at org creation).

**Endpoints** (all under `/api/v1`, behind `JwtAuthGuard` + `PermissionsGuard`):

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/accounts` | `crm.accounts.view` / `.create` |
| GET/PATCH/DELETE | `/accounts/:id` | `.view` / `.edit` / `.delete` |
| GET | `/accounts/:id/timeline` | `crm.accounts.view` |
| GET/POST | `/contacts` | `crm.contacts.view` / `.create` |
| GET/PATCH/DELETE | `/contacts/:id` | `.view` / `.edit` / `.delete` |
| GET/POST | `/activities` | `crm.activities.view` / `.create` |
| GET/PATCH/DELETE | `/activities/:id` | `.view` / `.edit` / `.delete` |
| GET | `/search` | per-type filtering, no blanket permission |

**Contracts** (`packages/contracts/src/crm.ts`, mirroring `identity.ts`'s
`interface` DTO + `xSchema`/`XInput` split): `Address`, `AccountDto`/
`createAccountSchema`/`CreateAccountInput`/`updateAccountSchema`,
equivalent for `ContactDto`/`ActivityDto`, plus `TimelineEntryDto` and
`SearchResultDto`. `ActivityDto`'s create schema requires `accountId` or
`contactId` via `.refine(...)`.

---

## 5. Sequencing (system stays runnable + tested after each checkpoint)

**Checkpoint A — Schema + contracts + permissions foundation**
`crm.schema.ts`, migration (hand-edited for tsvector + audit_log index),
`crm.ts` contracts, permission strings, `CRM_EVENT_TYPES`/`TIMELINE_EVENT_TYPES`.
Verify: typecheck both packages; Phase 1 e2e suite still green.

**Checkpoint B — Accounts backend complete + tested**
`AccountsService`/`AccountsController` (tenant-scoped exactly like
`TeamsService`), `crm.module.ts`, registered in `app.module.ts`,
`crm-accounts.e2e-spec.ts` (CRUD, cross-tenant 404s, Member 403 on delete).
Verify: e2e green.

**Checkpoint C — Contacts backend complete + tested**
`ContactsService`/`ContactsController` (validates `accountId` belongs to
the same org before insert), `crm-contacts.e2e-spec.ts`. Verify: e2e green.

**Checkpoint D — Activities + Timeline + Search complete + tested**
`ActivitiesService`/`ActivitiesController` (requires accountId or
contactId), `TimelineService`/`TimelineController`, `SearchService`/
`SearchController`, matching e2e specs. Verify: e2e green — full CRM
backend done, matching brief §36's checklist exactly.

**Checkpoint E — Frontend**
`DataTable`/`Dialog` primitives, TanStack Query hooks (`use-accounts.ts`
etc., mirroring `use-teams.ts`), accounts/contacts/activities list pages,
account detail page (fields, contacts table, timeline feed, log-activity
dialog), `nav.ts` permission gates on the three CRM entries. Verify
manually via dev server: Owner full CRUD + timeline ordering; Member has
delete buttons hidden and 403s on direct delete attempts.

**Checkpoint F — Deferred-scope note**
`docs/decisions/0002-crm-phase2-scope.md` — Documents and Custom Fields.

---

## 6. Frontend: introduce `DataTable` + `Dialog`

Phase 1 hand-rolled one `<table>` because there was exactly one list page.
Phase 2 built 3+ list pages plus a composite detail view — the break-even
point for extracting the pattern instead of copy-pasting it four times.

Kept minimal, not a component library:
- `data-table.tsx` — thin generic wrapper (`columns`, `data`, `isLoading`,
  `emptyMessage`) built on the same Tailwind `<table>` markup already in
  `administration/users/page.tsx` — a refactor of existing markup into a
  reusable shape, not a new visual style or dependency.
- `dialog.tsx` — minimal controlled modal (`open`/`onOpenChange`, `fixed
  inset-0` overlay, Escape-key handler) for account/contact/activity forms.
  No Radix dependency, consistent with the project's "hand-roll on
  Tailwind" approach.
- Everything else stayed Phase-1-style: `useState`-driven forms, native
  `<select>` for owner/account pickers, permission-gated buttons via
  `currentUser?.permissions.includes(...)`.

---

## Verification (all passed)

- Checkpoint A: typecheck + contracts build clean; e2e still 12/12.
- B/C/D: e2e green after each, including cross-tenant-404 and RBAC-403
  assertions for every new resource.
- E: manual verification via `pnpm dev` — Owner create/edit/delete on
  accounts/contacts/activities; account detail timeline shows both logged
  activities and account/contact update events in correct order; Member
  has delete buttons hidden and 403s on direct delete attempts.
- Final: `pnpm --filter @sales-platform/api build` and `pnpm --filter
  @sales-platform/web build` both clean; full e2e suite 30/30 across 7
  suites.

### Critical files
- `apps/api/src/database/schema/crm.schema.ts` — foundation
- `packages/contracts/src/crm.ts` — shared DTOs/schemas
- `packages/contracts/src/permissions.ts` — permission strings + Member bundle
- `apps/api/src/modules/crm/crm.module.ts` — mirrors `identity.module.ts`
- `apps/api/src/modules/crm/timeline/timeline.service.ts` — the extensible merge query
- `apps/api/test/tenant-isolation.e2e-spec.ts` — reference for `registerOrg` + cross-tenant assertion patterns
- `apps/web/src/lib/nav.ts` — permission gates for CRM nav entries
