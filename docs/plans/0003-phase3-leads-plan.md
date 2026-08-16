# Phase 3 — Leads Implementation Plan

> Written 2026-08-15, before implementation began. See
> [docs/architecture/overview.md](../architecture/overview.md) for the
> current-state description once Phase 3 lands, and the forthcoming
> ADR 0003 for what was deliberately left out.

## Context

Phase 1 (Identity & Access) and Phase 2 (CRM: accounts, contacts, activities,
timeline, search) are built, tested, and running. The brief's Section 36
phased plan calls for **Phase 3 — Leads** next: Lead CRUD, Lead scoring,
Sources, Qualification, Conversion, Duplicate detection (Section 7 has the
detailed feature list). "Lead Management" is its own bounded domain in the
brief's service list (Section 5), separate from CRM, so it gets its own
Postgres schema and its own top-level Nest module — same "schema-per-module"
boundary CRM already established, applied to a new domain instead of
extending an existing one.

Goal: add a `leads` module following Phase 1/2's exact conventions
(tenant-scoped services, permission-gated controllers, domain events →
audit log, soft delete, zod contracts), landing lead conversion as an event
that plugs straight into Phase 2's `TIMELINE_EVENT_TYPES` extension point —
this is the first real test of that extensibility design.

---

## 0. Scope decisions

| Sub-feature | Decision | Reasoning |
|---|---|---|
| **Lead → Account/Contact/Opportunity conversion** | Convert creates **Account + Contact only**. No Opportunity. | Sales Pipeline (Opportunities) is Phase 4 — the domain doesn't exist yet. Record as a short new ADR, same pattern as ADR 0002. When Phase 4 lands, `LeadsService.convert()` gets one more step. |
| **Duplicate detection** | Two mechanisms: (1) `GET /leads/duplicates?email=&company=` — read-only lookup the frontend calls before/while creating a lead, surfaces a non-blocking warning; (2) inside `convert()`, reuse an existing Account (case-insensitive exact name match) / Contact (case-insensitive exact email match) instead of inserting new rows. | Matches the brief's two distinct asks: a standalone "Duplicate detection" checklist item (§36) and "Avoid duplicate accounts and contacts during conversion" (§7). No fuzzy matching — that's Phase 8 "Advanced search" territory; exact-match-on-key-field is deliberately simple. |
| **Lead Sources** | Fixed zod enum (`LEAD_SOURCES`), not a manageable DB table. `/leads/sources` page shows a lead-count breakdown per source. | Same precedent as `ACTIVITY_TYPES`/`COMPANY_SIZES` in Phase 2 — the brief gives a fixed example list, not a request for org-configurable sources (unlike scoring, which it explicitly calls "configurable"). |
| **Lead Scoring rules** | Real, org-configurable rule table (`leads.lead_scoring_rules`): `field` + `operator` + `value` + `points`. Evaluated as a pure function against a lead's own fields. | Brief explicitly says "Create configurable scoring rules" — this is the one sub-feature that can't be a fixed enum. |
| **Scoring signals** | Rules can reference `companySize`, `email` (business-vs-free-provider check), `source`, `industry`, `estimatedValue` — fields the Lead record actually has. Behavioral signals from the brief's example ("visited pricing page," "downloaded brochure," "requested demo") are **not** implemented. | Those need a web-analytics/marketing-automation event pipeline that doesn't exist anywhere in this system's architecture (no such service in the brief's own service list). Building a tracking pipeline to support 3 example bullet points is out of scope — noted in the same ADR as the conversion decision. |
| **Score recompute** | Computed at write time (lead create/update) using currently-active rules. Editing a rule does **not** retroactively rescore existing leads. A per-lead `POST /leads/:id/recalculate-score` endpoint is the escape hatch. | Batch rescoring on every rule edit is real infra (background job) for a need that's easy to satisfy on-demand instead. Same "documented limitation, not a blocker" precedent as Phase 2's Member-permission backfill gap. |
| **Qualification** | `PATCH /leads/:id` can carry `status` transitions among `New/Contacted/Unqualified`, validated by an explicit transition map (`assertValidLeadTransition`). `POST /leads/:id/qualify` (the literal endpoint the brief names in §33) sets `Qualified` or `Unqualified` from `New`/`Contacted`. `Converted` is reachable only via `convert()`, and is terminal — no further transitions once converted, mirroring §35's "an accepted quotation cannot be silently modified" rule. | One shared transition guard function keeps the state machine in one place instead of scattered validation. |
| **Estimated value** | Postgres `numeric(12,2)` column; API contract accepts/returns a plain `number` (service layer does the `String()`/`Number()` conversion at the boundary). | `numeric` avoids float drift in storage per §35's "decimal-safe representation" rule, without introducing a money value-object type — no arithmetic happens on this field in Phase 3 (that's Quotations' job in Phase 5). |
| **Location** | Plain `text`, not a structured `Address`. | Brief just says "Location" for leads (vs. full billing/shipping addresses for Accounts) — a free-text field like "Bangalore, India" is what's actually being asked for. |
| **Custom fields** | Still deferred — same ADR 0002 as Phase 2, not repeated here. | No new information changes that decision. |
| **Global search inclusion** | Leads are **not** added to Phase 2's `SearchService`. | §36 places "Advanced search" in Phase 8, not Phase 3. Phase 3's own checklist doesn't mention search. |

---

## 1. Data model

New file `apps/api/src/database/schema/leads.schema.ts`, `pgSchema("leads")`,
added to the schema barrel. Follows `crm.schema.ts`'s exact conventions
(uuid PK via `$defaultFn`, `organizationId` FK cascade, timestamptz
audit columns, soft delete).

```ts
export const leadsSchema = pgSchema("leads");

export const LEAD_SOURCES = ["website","referral","advertisement","linkedin","cold_outreach","event","import","api","partner"] as const;
export const LEAD_STATUSES = ["New","Contacted","Qualified","Unqualified","Converted"] as const;

export const leads = leadsSchema.table("leads", {
  id, organizationId,
  name: text().notNull(),          // person's name
  company: text(),
  email: text(),
  phone: text(),
  source: text().notNull(),         // LEAD_SOURCES, zod-enforced
  campaign: text(),
  ownerId: uuid().references(() => users.id, { onDelete: "set null" }),
  status: text().notNull().default("New"),   // LEAD_STATUSES, zod + transition-guard enforced
  score: integer().notNull().default(0),
  industry: text(),
  location: text(),
  estimatedValue: numeric("estimated_value", { precision: 12, scale: 2 }),
  currency: text(),
  notes: text(),
  tags: jsonb().$type<string[]>().notNull().default([]),
  convertedAccountId: uuid().references(() => accounts.id, { onDelete: "set null" }),
  convertedContactId: uuid().references(() => contacts.id, { onDelete: "set null" }),
  convertedAt: timestamp({ withTimezone: true }),
  createdAt, updatedAt, createdBy, updatedBy, deletedAt,
}, (table) => ({
  orgIdx: index().on(table.organizationId),
  orgStatusIdx: index().on(table.organizationId, table.status),
  orgEmailIdx: index().on(table.organizationId, table.email),   // duplicate lookup
  ownerIdx: index().on(table.ownerId),
}));

export const leadScoringRules = leadsSchema.table("lead_scoring_rules", {
  id, organizationId,
  name: text().notNull(),
  field: text().notNull(),      // "companySize"|"email"|"source"|"industry"|"estimatedValue"
  operator: text().notNull(),   // "equals"|"in"|"greaterThan"|"lessThan"|"isBusinessEmail"
  value: jsonb().$type<string | number | string[] | null>(),
  points: integer().notNull(),
  active: boolean().notNull().default(true),
  createdAt, updatedAt, createdBy, updatedBy,
}, (table) => ({ orgIdx: index().on(table.organizationId) }));
```

`leads` imports `accounts`/`contacts` from `crm.schema.ts` for the
`convertedAccountId`/`convertedContactId` FKs — this is the one place the
leads module reads across a schema boundary, and it's read-only (a
foreign key, not a query), consistent with "no module imports another
module's repository directly."

`pnpm --filter @sales-platform/api db:generate` should produce this cleanly
with no hand-editing needed (no generated/tsvector columns this time).

---

## 2. Scoring engine

`apps/api/src/modules/leads/scoring/evaluate-lead-score.ts` — pure
function, no DB/Nest dependencies, unit-tested directly (the brief's
Testing section, §30, explicitly names "lead scoring" as required unit-test
coverage):

```ts
export function isBusinessEmail(email: string | null): boolean { ... }  // domain not in a small free-provider denylist
export function evaluateRule(rule: LeadScoringRule, lead: LeadScoringFields): boolean { ... }
export function computeLeadScore(rules: LeadScoringRule[], lead: LeadScoringFields): number {
  return rules.filter(r => r.active).filter(r => evaluateRule(r, lead)).reduce((sum, r) => sum + r.points, 0);
}
```

`apps/api/src/modules/leads/scoring/evaluate-lead-score.spec.ts` — plain
Jest unit test (no e2e harness), following the existing pattern in
`password.service.spec.ts` / `permissions.guard.spec.ts`. Covers: each
operator, business-vs-free email, inactive rules excluded, multiple
matching rules summed.

`ScoringRulesService`/`ScoringRulesController` — CRUD over
`lead_scoring_rules`, tenant-scoped like every other Phase 2 service.
`LeadsService` calls `computeLeadScore()` on create/update (loading active
rules for the org first) and stores the result on `score`.

---

## 3. Conversion (transaction + duplicate reuse)

`LeadsService.convert(organizationId, actorId, leadId)`:

1. Load the lead; 404 if missing/cross-tenant (existing `findById` pattern).
2. `BadRequestException` if `status !== "Qualified"` — must qualify before
   converting, a server-enforced business rule per §35.
3. Wrapped in `this.db.transaction(async (tx) => { ... })` — confirmed
   supported: `database.module.ts` already exports a `DbTransaction`/`Db`
   type explicitly for transaction-composable repository methods, unused
   until now. This is the first multi-table atomic write in the codebase.
4. Inside the transaction:
   - Find an existing Account with case-insensitive exact name match on
     `lead.company` (skip if `company` is blank) → reuse; else insert a
     new Account (`name: lead.company ?? lead.name`, `industry`, `ownerId`).
   - Find an existing Contact with case-insensitive exact email match on
     `lead.email` (skip if `email` is blank) → reuse (backfilling
     `accountId` if it was null); else insert a new Contact (naive
     firstName/lastName split of `lead.name`, `email`, `phone`, `ownerId`,
     `accountId`).
   - Update the lead: `status: "Converted"`, `convertedAccountId`,
     `convertedContactId`, `convertedAt: now`.
5. Publish `lead.converted` with `payload: { leadId, accountId, contactId, reusedExistingAccount, reusedExistingContact }`.
6. Return `{ lead, account, contact }`.

`packages/contracts/src/events.ts`: add `"lead.converted"` to
**`TIMELINE_EVENT_TYPES`** (payload has `accountId`) — this is the concrete
proof of Phase 2's extensibility design: the timeline merge query in
`TimelineService` needs zero changes for the converted account's timeline
to show the conversion event.

---

## 4. API surface

**New permissions** (`packages/contracts/src/permissions.ts` — `leads.view/create/edit/convert`
already reserved from Phase 1/2, do not redefine):
```ts
"leads.delete",
"leads.scoring.manage",
```
**`SYSTEM_ROLE_PERMISSIONS.Member`**: add `"leads.edit"`, `"leads.convert"`
(already has `view`/`create`). `leads.delete` and `leads.scoring.manage`
stay Owner/Admin-only, same as every other destructive/config action.

**Events** (`packages/contracts/src/events.ts`):
```ts
export const LEAD_EVENT_TYPES = [
  "lead.created", "lead.updated", "lead.status_changed", "lead.converted", "lead.deleted",
  "lead.scoring_rule_created", "lead.scoring_rule_updated", "lead.scoring_rule_deleted",
] as const;
```
`lead.status_changed` (payload `{leadId, fromStatus, toStatus}`) covers
every transition including the `/qualify` endpoint — one event type, not
one per state, keeping the catalog small.

**Endpoints** (all under `/api/v1`, `JwtAuthGuard` + `PermissionsGuard`):

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/leads` | `leads.view` / `.create` |
| GET/PATCH/DELETE | `/leads/:id` | `.view` / `.edit` / `.delete` |
| GET | `/leads/duplicates?email=&company=` | `leads.view` |
| GET | `/leads/stats/by-source` | `leads.view` |
| POST | `/leads/:id/qualify` | `leads.edit` |
| POST | `/leads/:id/convert` | `leads.convert` |
| POST | `/leads/:id/recalculate-score` | `leads.edit` |
| GET/POST | `/leads/scoring-rules` | `leads.view` / `leads.scoring.manage` |
| PATCH/DELETE | `/leads/scoring-rules/:id` | `leads.scoring.manage` |

**Contracts** (`packages/contracts/src/leads.ts`, new — mirrors `crm.ts`'s
`interface` DTO + `xSchema`/`XInput` split): `LEAD_SOURCES`, `LeadSource`,
`LEAD_STATUSES`, `LeadStatus`, `LeadDto`, `createLeadSchema`/`CreateLeadInput`,
`updateLeadSchema` (excludes `status`), `qualifyLeadSchema` (`{ outcome: "qualified" | "unqualified" }`),
`ConvertLeadResultDto { lead: LeadDto; account: AccountDto; contact: ContactDto }`,
`LeadScoringRuleDto`, `createScoringRuleSchema`/`CreateScoringRuleInput`,
`updateScoringRuleSchema`, `LeadSourceStatDto { source: string; count: number }`.
Add `export * from "./leads"` to `packages/contracts/src/index.ts`.

---

## 5. Sequencing (system stays runnable + tested after each checkpoint)

**Checkpoint A — Schema + contracts + permissions foundation**
1. `leads.schema.ts` (new) + barrel export
2. `db:generate` + `db:migrate`
3. `packages/contracts/src/leads.ts` (new) + barrel export
4. `permissions.ts` — `leads.delete`, `leads.scoring.manage`, Member bundle update
5. `events.ts` — `LEAD_EVENT_TYPES`, add `lead.converted` to `TIMELINE_EVENT_TYPES`
   - Verify: typecheck both packages; full e2e suite still green (30/30, nothing touched yet)

**Checkpoint B — Lead CRUD + scoring engine, tested**
6. `evaluate-lead-score.ts` + `evaluate-lead-score.spec.ts` (unit tests, run via `pnpm test`)
7. `scoring/scoring-rules.service.ts` + `.controller.ts`
8. `leads/leads.service.ts` (CRUD, `assertValidLeadTransition`, calls `computeLeadScore` on create/update) + `.controller.ts`
9. `leads.module.ts` (new, top-level like `crm.module.ts`) registered in `app.module.ts`
10. `apps/api/test/leads.e2e-spec.ts` — CRUD, cross-tenant 404s, RBAC 403 (Member can't delete/manage scoring), score computed correctly against a seeded rule
    - Verify: unit tests green, e2e green

**Checkpoint C — Qualification, duplicate detection, conversion, tested**
11. `POST /leads/:id/qualify`, invalid-transition rejection
12. `GET /leads/duplicates`
13. `GET /leads/stats/by-source`
14. `LeadsService.convert()` (transaction, reuse-or-create Account/Contact)
15. `apps/api/test/leads-conversion.e2e-spec.ts` — convert creates Account+Contact; converting again against a lead with a matching company/email reuses instead of duplicating; convert rejected unless Qualified; converted lead is immutable to further status changes; `lead.converted` shows up via `GET /accounts/:id/timeline` (proves the `TIMELINE_EVENT_TYPES` extension)
    - Verify: e2e green — full Leads backend done, matching brief §36's checklist exactly

**Checkpoint D — Frontend**
16. `apps/web/src/hooks/use-leads.ts`, `use-lead-scoring-rules.ts` — mirror `use-accounts.ts`'s shape
17. `apps/web/src/components/crm/lead-form.tsx` (or `components/leads/`) — shared controlled form
18. Replace `leads/page.tsx` stub — list + create dialog (duplicate-check warning on email/company blur)
19. New `leads/[id]/page.tsx` — fields, status/score display, qualify + convert actions, link to resulting account after conversion
20. Replace `leads/sources/page.tsx` stub — per-source lead counts from `/leads/stats/by-source`
21. Replace `leads/scoring/page.tsx` stub — scoring rules `DataTable` + create/edit `Dialog`
22. `nav.ts` — add `permission: "leads.view"` to the three Leads entries
    - Verify manually via dev server: create a lead, see score reflect a seeded rule, qualify it, convert it, confirm the new/reused account shows the conversion on its timeline; Member can't reach scoring-rule management or delete

**Checkpoint E — Deferred-scope note**
23. `docs/decisions/0003-leads-phase3-scope.md` (new) — Opportunity-less conversion, behavioral scoring signals deferred, same pattern as ADR 0002

---

## Verification

- After A: typecheck + contracts build clean; e2e still 30/30.
- After B/C: e2e green after each, including cross-tenant-404, RBAC-403,
  and the conversion/duplicate/timeline-extension assertions.
- Unit tests (`pnpm --filter @sales-platform/api test`) green, covering the
  scoring evaluator per §30's explicit requirement.
- After D: manual verification via `pnpm dev` — full lead lifecycle
  (create → duplicate warning → qualify → convert → timeline) as Owner;
  Member RBAC boundaries confirmed.
- `pnpm --filter @sales-platform/api build` and `pnpm --filter @sales-platform/web build` clean, final gate.

### Critical files
- `apps/api/src/database/schema/leads.schema.ts` (new) — foundation
- `packages/contracts/src/leads.ts` (new) — shared DTOs/schemas
- `apps/api/src/modules/leads/scoring/evaluate-lead-score.ts` (new) — the testable scoring core
- `apps/api/src/modules/leads/leads/leads.service.ts` (new) — CRUD, transition guard, conversion transaction
- `apps/api/src/database/database.module.ts` — existing `DbTransaction`/`Db` types, first real usage
- `packages/contracts/src/events.ts` — `lead.converted` added to `TIMELINE_EVENT_TYPES`
- `apps/api/test/tenant-isolation.e2e-spec.ts` — reference pattern for new e2e specs
- `apps/web/src/lib/nav.ts` — permission gates for Leads nav entries
