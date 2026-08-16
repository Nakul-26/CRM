# Phase 4 — Sales Pipeline (Opportunities) Implementation Plan

## Context

Phases 1-3 (Identity, CRM, Leads) are built, tested, and running. The brief's
Section 36 phased plan calls for **Phase 4 — Sales Pipeline** next:
Opportunities, Pipelines, Stages, Kanban, Forecast, Activities, Analytics
(Section 8 has the detailed feature list; Section 21 has the analytics
metrics). "Sales" is its own bounded domain in the brief's service list
(Section 5), separate from CRM/Leads, so it gets its own Postgres schema and
top-level Nest module — same "schema-per-module" boundary CRM and Leads
already established.

This phase also closes a gap ADR 0003 explicitly deferred: Lead conversion
today only creates an Account + Contact because the Opportunity domain
didn't exist yet. Now that it will, `LeadsService.convert()` gets extended
to also create an Opportunity, exactly as ADR 0003 promised.

Goal: add a `sales` module following Phase 1-3's exact conventions
(tenant-scoped services, permission-gated controllers, domain events → audit
log, soft delete, zod contracts), with org-configurable pipelines/stages
(the one genuinely new modeling challenge — Leads/CRM never needed
user-defined workflows before), and prove out two more extension points:
`TIMELINE_EVENT_TYPES` (already exercised once by `lead.converted`) and the
existing `db.transaction()` pattern from `LeadsService.convert()` (extended,
not re-invented, to also insert an Opportunity).

---

## 0. Scope decisions

| Sub-feature | Decision | Reasoning |
|---|---|---|
| **Pipelines/Stages** | Real, org-configurable tables (`sales.pipelines`, `sales.stages`), not a fixed enum. Each org gets a lazily-created default pipeline ("Sales Pipeline") with the brief's 6 example stages the first time `GET /pipelines` or `POST /opportunities` is called with none configured. | Brief explicitly says "Allow organizations to create custom pipelines and stages" — this is Leads' "configurable scoring rules" precedent applied to a new sub-feature. Lazy default-creation (vs. seeding on org-creation via an event listener) avoids a race between org registration and first use, and needs no new event-consumer plumbing. |
| **Stage transitions** | No fixed transition graph (impossible for user-defined stages). Guard is just: (1) target stage must belong to the opportunity's own pipeline, (2) once in a stage flagged `isWon`/`isLost`, the opportunity is terminal — no further stage moves. Stage change is its own action endpoint (`POST /opportunities/:id/stage`), excluded from the generic PATCH surface. | Mirrors Leads' `assertValidLeadTransition` precedent (status excluded from PATCH, terminal state enforced) adapted for dynamic stages. Matches brief §35: "a closed opportunity cannot arbitrarily return to an earlier stage." Kanban drag-to-any-column (except out of closed) is standard CRM UX — no need to hardcode a linear stage order. |
| **Won/Lost detection** | `isWon`/`isLost` boolean flags on `stages`, not name-matching ("Closed Won" string). Opportunity gets a denormalized `outcome: "open"\|"won"\|"lost"` column, set when it lands on a flagged stage, so analytics queries don't need a stages join. | Custom pipelines can name their terminal stages anything ("Signed", "Dead") — flags, not names, are the source of truth. Denormalizing outcome keeps `stats/summary` a single grouped query, same pattern as Leads' `statsBySource`. |
| **Products / Attachments on Opportunity** | Deferred. Not modeled in Phase 4. | Product Catalog is Phase 5 (Section 36) — same reasoning ADR 0003 used to defer Opportunity creation itself. Attachments need file-upload infra that doesn't exist anywhere yet (no S3/storage abstraction in any phase so far) and isn't in Phase 4's own checklist (Section 36), only in Section 8's fuller feature list. Both recorded as scope cuts in a new ADR, same pattern as ADR 0002/0003. |
| **Activities on Opportunity** | Extend `crm.activities` with a nullable `opportunity_id` column (no DB-level FK — see below), filterable the same way `accountId`/`contactId` already are. | Phase 4's own checklist explicitly lists "Activities." An opportunity's activities need to be scoped tighter than "everything on the account" (an account can have several concurrent opportunities). Reuses Phase 2's existing `ActivitiesService`/table instead of building a parallel one. |
| **`opportunity_id` FK constraint** | Plain `uuid` column, no `.references()`. | `sales.schema.ts` already imports `accounts`/`contacts` from `crm.schema.ts` (for Opportunity's own FKs); adding a DB-level FK from `crm.schema.ts` back to `sales.schema.ts` for `activities.opportunityId` would be a circular file import. Same precedent as `createdBy`/`updatedBy` columns, which are already unconstrained `uuid`s. Validated at the application layer (existence check) instead. |
| **Stage history** | No dedicated history table — read `identity.audit_log` filtered to `eventType = 'opportunity.stage_changed'` and `payload->>'opportunityId'`. | Same precedent as `TimelineService`: audit log is already the append-only history; a parallel table would duplicate it. |
| **Source** | Opportunity reuses `LEAD_SOURCES` (re-exported as `OpportunitySource`), not a new enum. | Same list of channels ("website," "referral," ...) applies to where a deal originated — avoids a duplicate enum for the same concept. |
| **Analytics scope** | `GET /opportunities/stats/summary` (total pipeline value, weighted pipeline, won/lost revenue, win rate, avg deal size, sales cycle days, sales velocity) and `GET /opportunities/stats/forecast` (grouped by expected-close month). No dedicated dashboards/reports UI beyond the Forecast page. | Matches Section 21's "Sales" metrics list and Phase 4's "Forecast"/"Analytics" checklist items. Phase 8 ("Analytics & Automation") is a whole later phase for dashboards/reporting UX — building that now would be scope creep into a phase that doesn't exist yet, same reasoning as every prior ADR's scope cuts. |
| **Lead conversion → Opportunity** | `LeadsService.convert()` is extended (not re-designed) to also create an Opportunity against the org's default pipeline/first stage, inside the same transaction that creates/reuses the Account and Contact. `ConvertLeadResultDto` gains an `opportunity` field. | This is exactly what ADR 0003 said would happen once Phase 4 landed: "nothing about today's shape needs to change to add it." Closes the brief's Section 7 conversion spec (`Lead → Account + Contact + Opportunity`) now that the Opportunity domain exists. |

---

## 1. Data model

New file `apps/api/src/database/schema/sales.schema.ts`, `pgSchema("sales")`,
added to the schema barrel. Follows `leads.schema.ts`'s conventions exactly.

```ts
export const salesSchema = pgSchema("sales");

export const pipelines = salesSchema.table("pipelines", {
  id, organizationId,
  name: text().notNull(),
  isDefault: boolean().notNull().default(false),
  createdAt, updatedAt, createdBy, updatedBy, deletedAt,
}, (t) => ({ orgIdx: index().on(t.organizationId) }));

export const stages = salesSchema.table("stages", {
  id, organizationId,
  pipelineId: uuid().notNull().references(() => pipelines.id, { onDelete: "cascade" }),
  name: text().notNull(),
  order: integer().notNull(),
  probability: integer().notNull().default(0),
  isWon: boolean().notNull().default(false),
  isLost: boolean().notNull().default(false),
  createdAt, updatedAt,
}, (t) => ({ pipelineOrderIdx: index().on(t.pipelineId, t.order) }));

export const OPPORTUNITY_OUTCOMES = ["open", "won", "lost"] as const;

export const opportunities = salesSchema.table("opportunities", {
  id, organizationId,
  name: text().notNull(),
  accountId: uuid().notNull().references(() => accounts.id, { onDelete: "cascade" }),   // from crm.schema.ts
  contactId: uuid().references(() => contacts.id, { onDelete: "set null" }),             // from crm.schema.ts
  ownerId: uuid().references(() => users.id, { onDelete: "set null" }),
  pipelineId: uuid().notNull().references(() => pipelines.id),
  stageId: uuid().notNull().references(() => stages.id),
  outcome: text().notNull().default("open"),   // OPPORTUNITY_OUTCOMES
  value: numeric("value", { precision: 12, scale: 2 }),
  currency: text(),
  probability: integer().notNull().default(0),
  expectedCloseDate: timestamp({ withTimezone: true }),
  closedAt: timestamp({ withTimezone: true }),
  source: text(),   // LEAD_SOURCES, reused
  competitors: jsonb().$type<string[]>().notNull().default([]),
  notes: text(),
  createdAt, updatedAt, createdBy, updatedBy, deletedAt,
}, (t) => ({
  orgIdx: index().on(t.organizationId),
  orgOutcomeIdx: index().on(t.organizationId, t.outcome),
  accountIdx: index().on(t.accountId),
  pipelineStageIdx: index().on(t.pipelineId, t.stageId),
}));
```

`crm.schema.ts`'s `activities` table gets one new column:
```ts
opportunityId: uuid("opportunity_id"),   // no .references() — see scope-decision table above
```
plus an index `activities_opportunity_idx`.

`pnpm --filter @sales-platform/api db:generate` should produce this cleanly.

---

## 2. Contracts

`packages/contracts/src/sales.ts` (new) — mirrors `leads.ts`'s shape exactly:
`PipelineDto`, `StageDto`, `OpportunityDto`, `OpportunityForecastPointDto`,
`OpportunitySummaryStatsDto`, `createPipelineSchema`/`updatePipelineSchema`,
`createStageSchema`/`updateStageSchema`, `createOpportunitySchema` (accountId
required, pipelineId/stageId optional — defaulted server-side),
`updateOpportunitySchema` (excludes `stageId`/`pipelineId`/`accountId` —
immutable/action-only, same as Leads excluding `status`), `moveStageSchema`
(`{ stageId, probability? }`). Re-exports `OpportunitySource = LeadSource`
from `./leads`. `ConvertLeadResultDto` (in `leads.ts`) gains
`opportunity: { id: string; name: string; stageId: string } | null`.

`packages/contracts/src/index.ts` — add `export * from "./sales";`.

`activities.ts` contracts — `createActivitySchema`/`ActivityDto` gain
optional `opportunityId`.

---

## 3. Permissions & events

`permissions.ts`: add `"opportunities.delete"`, `"opportunities.pipelines.manage"`
to `PERMISSIONS` (`opportunities.view/create/edit` already reserved from
Phase 1). Member bundle: add `"opportunities.edit"` (view/create already
present); `opportunities.delete` and `opportunities.pipelines.manage` stay
Owner/Admin-only, matching `leads.delete`/`leads.scoring.manage`.

`events.ts`: new `SALES_EVENT_TYPES` array (bundling opportunity + pipeline +
stage events, same as `LEAD_EVENT_TYPES` bundled lead + scoring-rule
events):
```ts
export const SALES_EVENT_TYPES = [
  "opportunity.created", "opportunity.updated", "opportunity.stage_changed",
  "opportunity.won", "opportunity.lost", "opportunity.deleted",
  "pipeline.created", "pipeline.updated", "pipeline.deleted",
  "stage.created", "stage.updated", "stage.deleted",
] as const;
```
`TIMELINE_EVENT_TYPES` gains `"opportunity.created"`, `"opportunity.stage_changed"`,
`"opportunity.won"`, `"opportunity.lost"` (all payloads carry `accountId`).
`TimelineService.summarizeEvent()` gets matching `case`s.

---

## 4. Backend modules

New `apps/api/src/modules/sales/`:
```
sales.module.ts
opportunities/opportunities.controller.ts
opportunities/opportunities.service.ts
pipelines/pipelines.controller.ts
pipelines/pipelines.service.ts   (owns both Pipeline and Stage CRUD — stages are nested resources)
```

**`PipelinesService`**: `list`, `findById`, `create`, `update` (incl.
unsetting any other org pipeline's `isDefault` when setting a new one),
`delete` (400 if non-deleted opportunities still reference it), stage CRUD
nested under a pipeline (`createStage`, `updateStage`, `deleteStage`,
`findStage`), and `getOrCreateDefault(organizationId)` — wrapped in
`this.db.transaction()`, inserts "Sales Pipeline" + the brief's 6 example
stages (Qualification 10%, Discovery 25%, Proposal 50%, Negotiation 75%,
Closed Won 100%/isWon, Closed Lost 0%/isLost) the first time it's needed,
otherwise returns the existing default. Idempotent, called from both
`PipelinesController`'s list endpoint and `OpportunitiesService.create()`.

**`OpportunitiesService`**: `list` (filters: pipelineId, stageId, ownerId,
outcome), `findById`, `create` (validates `accountId`/`contactId` exist in
org via direct read against `crm.accounts`/`crm.contacts` — same narrow
read-only cross-schema pattern Leads already uses for its converted-*
FKs and `ActivitiesService.requireAccountInOrganization`; defaults
pipeline/stage via `PipelinesService.getOrCreateDefault`/first-stage-by-order
when omitted; publishes `opportunity.created`), `update` (generic PATCH,
publishes `opportunity.updated`), `delete` (soft, publishes
`opportunity.deleted`), `moveStage(id, {stageId, probability?})` (guards:
current stage not already won/lost, target stage belongs to the same
pipeline; sets `probability` from target stage default unless overridden,
sets `closedAt`/`outcome` when target `isWon`/`isLost`; publishes
`opportunity.stage_changed` always, plus `opportunity.won`/`opportunity.lost`
when applicable), `stageHistory(id)` (reads `auditLog` filtered by
`payload->>'opportunityId'` + `eventType = 'opportunity.stage_changed'`,
ordered by `createdAt`), `summaryStats(organizationId)` (grouped-by-outcome
aggregate query, same `sql<number>` pattern as Leads' `statsBySource`;
computes win rate, avg deal size, avg sales cycle days, and sales velocity
= `(wonCount * avgDealSize * winRate) / avgSalesCycleDays`, guarding
divide-by-zero), `forecastByMonth(organizationId)` (groups open
opportunities by `to_char(expected_close_date, 'YYYY-MM')`, sums value and
weighted value).

`sales.module.ts` registers both controllers/services, no special
imports/exports needed (matches `leads.module.ts` — `DATABASE_CONNECTION`
and `DomainEventBus` are already global).

`app.module.ts`: import `SalesModule`, add after `LeadsModule`.

**Routes** (`JwtAuthGuard` + `PermissionsGuard`, `/api/v1` prefix):

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/opportunities` | `.view` / `.create` |
| GET/PATCH/DELETE | `/opportunities/:id` | `.view` / `.edit` / `.delete` |
| POST | `/opportunities/:id/stage` | `opportunities.edit` |
| GET | `/opportunities/:id/stage-history` | `opportunities.view` |
| GET | `/opportunities/stats/summary` | `opportunities.view` |
| GET | `/opportunities/stats/forecast` | `opportunities.view` |
| GET/POST | `/pipelines` | `opportunities.view` / `.pipelines.manage` |
| GET/PATCH/DELETE | `/pipelines/:id` | `.view` / `.pipelines.manage` |
| POST/PATCH/DELETE | `/pipelines/:pipelineId/stages(/:stageId)` | `opportunities.pipelines.manage` |

(Route registration order: `stats/*` and `:id/stage-history` before the
generic `:id` GET, same lesson already applied in `leads.controller.ts`.)

---

## 5. Cross-module wiring

**Lead conversion → Opportunity** (`apps/api/src/modules/leads/leads/leads.service.ts`):
`LeadsModule` imports `SalesModule` (exporting `PipelinesService`) so
`LeadsService` can call `pipelines.getOrCreateDefault(organizationId)`
*before* opening its transaction (that call does its own internal
transaction if it needs to seed defaults — can't nest inside another). Then,
inside the existing `db.transaction()` in `convert()`, after the
Account/Contact reuse-or-create logic, insert one row into `sales.opportunities`
(name derived from the lead, e.g. `${lead.company ?? lead.name} - New Business`,
`accountId`/`contactId` from the just-created/reused records, `pipelineId`/
`stageId` from the default pipeline's first stage, `value` from
`lead.estimatedValue`, `source` from `lead.source`). This extends the
existing documented exception (ADR 0003 item 3) rather than creating a new
one — same transaction, same rationale (atomicity: a lead marked
"converted" should never leave a dangling half-created deal). Publish
`opportunity.created` alongside the existing `lead.converted`/account/contact
events, outside the transaction. `ConvertLeadResultDto` gains the new
`opportunity` field; `leads-conversion.e2e-spec.ts` gets a new assertion.

**Activities on Opportunities**: `ActivitiesController`/`Service` gain an
optional `opportunityId` filter/field (mirrors the existing `accountId`/
`contactId` handling exactly — add one more `and()` condition and one more
optional insert field). `OpportunitiesService` doesn't need its own
activity-logging endpoint; the frontend opportunity detail page calls the
existing `GET/POST /activities?opportunityId=` directly, same as the
account detail page already does for `accountId`.

**Timeline**: `TIMELINE_EVENT_TYPES` + `summarizeEvent()` changes from
section 3 — zero changes to the merge query itself (same proof-point as
`lead.converted`).

---

## 6. Frontend

`apps/web/src/hooks/use-opportunities.ts` (new) — mirrors `use-leads.ts`:
`useOpportunities(filters?)`, `useOpportunity(id)`, `useOpportunityStats()`,
`useOpportunityForecast()`, `useOpportunityStageHistory(id)`,
`useCreateOpportunity`, `useUpdateOpportunity`, `useDeleteOpportunity`,
`useMoveOpportunityStage`.

`apps/web/src/hooks/use-pipelines.ts` (new) — `usePipelines()`,
`useCreatePipeline`/`useUpdatePipeline`/`useDeletePipeline`,
`useCreateStage`/`useUpdateStage`/`useDeleteStage`.

`apps/web/src/components/sales/opportunity-form.tsx` (new) — controlled
form mirroring `lead-form.tsx`: name, account `<select>` (from
`useAccounts()`), contact `<select>` (from `useContacts()` filtered
client-side to the chosen account), owner, value, currency, expected close
date, source `<select>` (`LEAD_SOURCES`), competitors (comma-separated),
notes. Pipeline/stage are set server-side on create (not in the form);
editable only via the Kanban/stage-move action afterward.

Replace the three existing `ComingSoon` stubs:

- `apps/web/src/app/(dashboard)/sales/opportunities/page.tsx` — `DataTable`
  (Name/Account/Stage/Value/Probability/Owner columns) + create `Dialog`
  with `OpportunityForm`, filters by pipeline/owner/outcome. Row links to
  a new `sales/opportunities/[id]/page.tsx` detail route (status/outcome
  card with stage-move action buttons for reachable-from-current-stage
  moves, details card, related-activities list reusing the `/activities`
  hook filtered by `opportunityId`, stage-history list).
- `apps/web/src/app/(dashboard)/sales/pipeline/page.tsx` — Kanban board:
  columns = the selected pipeline's stages ordered by `order`, cards =
  open opportunities in that stage (name, account, value, probability,
  owner avatar-less text). Native HTML5 drag-and-drop (`draggable`,
  `onDragStart`/`onDrop`) calling `useMoveOpportunityStage` on drop — no
  new DnD dependency, consistent with the hand-rolled-components
  convention. A "Manage Stages" `Dialog` (gated `opportunities.pipelines.manage`)
  for stage CRUD (name, order number input, probability, isWon/isLost
  checkboxes) and a pipeline picker if the org has more than one pipeline.
- `apps/web/src/app/(dashboard)/sales/forecast/page.tsx` — Analytics/forecast
  dashboard: stat cards for the `stats/summary` metrics (pipeline value,
  weighted pipeline, win rate, avg deal size, sales cycle days, sales
  velocity, won/lost revenue) + a Recharts bar chart (already an installed
  dependency, unused until now, matching the brief's stack list) of
  monthly forecasted value from `stats/forecast`, plus a small table
  underneath with the same numbers for accessibility/no-JS-chart fallback.

`apps/web/src/lib/nav.ts` — add `permission: "opportunities.view"` to the
three Sales `NavItem` entries (same pattern as Leads in Phase 3).

---

## 7. Sequencing (system stays runnable + tested after each checkpoint)

**Checkpoint A — Schema + contracts + permissions + events foundation**
1. `sales.schema.ts` (new) + barrel export; `crm.schema.ts` — add
   `activities.opportunityId` column
2. `db:generate` + `db:migrate`
3. `packages/contracts/src/sales.ts` (new) + barrel export; extend
   `leads.ts`'s `ConvertLeadResultDto`; extend `activities.ts`
4. `permissions.ts` — `opportunities.delete`, `opportunities.pipelines.manage`, Member bundle update
5. `events.ts` — `SALES_EVENT_TYPES`, add 4 opportunity events to `TIMELINE_EVENT_TYPES`
   - Verify: typecheck both packages; full e2e suite still green (39/39, nothing touched yet)

**Checkpoint B — Pipelines/Stages + Opportunities CRUD, tested**
6. `pipelines/pipelines.service.ts` + `.controller.ts` (incl. `getOrCreateDefault`, stage CRUD)
7. `opportunities/opportunities.service.ts` + `.controller.ts` (CRUD + `moveStage`)
8. `sales.module.ts` registered in `app.module.ts`
9. `apps/api/test/sales.e2e-spec.ts` — pipeline default-seeding, opportunity CRUD,
   cross-tenant 404s, RBAC 403 (Member can create/edit opportunities but not
   delete or manage pipelines), stage-move guard (rejects moving off a
   closed stage, rejects cross-pipeline stage id), `opportunity.won`/`opportunity.lost`
   set `outcome`/`closedAt` correctly
   - Verify: e2e green

**Checkpoint C — Analytics + stage history, tested**
10. `stats/summary`, `stats/forecast`, `:id/stage-history` endpoints
11. e2e assertions: summary numbers match a small hand-built scenario (2 won, 1 lost, 1 open), forecast groups by month correctly, stage history shows each transition in order
    - Verify: e2e green

**Checkpoint D — Lead conversion → Opportunity, tested**
12. `LeadsModule` imports `SalesModule`; `LeadsService.convert()` extended
    per section 5; `ConvertLeadResultDto.opportunity` populated
13. Update `leads-conversion.e2e-spec.ts` — converting a Qualified lead now
    also asserts an Opportunity exists, linked to the resulting Account,
    in the default pipeline's first stage
    - Verify: e2e green — closes ADR 0003's deferred item

**Checkpoint E — Activities + Timeline extension, tested**
14. `ActivitiesController`/`Service` — `opportunityId` filter/field
15. `TimelineService.summarizeEvent()` cases for the 4 new timeline event types
16. e2e assertion: an opportunity's `opportunity.created`/`opportunity.won`
    events show up on its account's `GET /accounts/:id/timeline`; an
    activity logged with `opportunityId` is excluded from a *different*
    opportunity's activity list but included in its own
    - Verify: e2e green — full Sales backend done, matching brief §36's checklist

**Checkpoint F — Frontend**
17. `use-opportunities.ts`, `use-pipelines.ts`
18. `components/sales/opportunity-form.tsx`
19. Replace `sales/opportunities/page.tsx` stub — list + create dialog; new `sales/opportunities/[id]/page.tsx`
20. Replace `sales/pipeline/page.tsx` stub — Kanban + stage management dialog
21. Replace `sales/forecast/page.tsx` stub — analytics cards + Recharts bar chart + table
22. `nav.ts` — add `permission: "opportunities.view"` to the three Sales entries
    - Verify manually via dev server: create an opportunity, drag it across
      Kanban columns into Closed Won, confirm outcome/analytics update,
      convert a Qualified lead and confirm the resulting Opportunity
      appears; Member can't reach pipeline management or delete

**Checkpoint G — Docs**
23. `docs/decisions/0004-sales-phase4-scope.md` (new ADR) — Products/Attachments
    deferred to Phase 5/later, unconstrained `opportunityId` FK rationale,
    Phase 8 deferring deeper dashboards
24. `docs/plans/0004-phase4-sales-plan.md` (this plan, persisted)
25. `docs/architecture/overview.md` — module list, data ownership, events,
    new "Phase 4 scope" section, link new ADR/plan from the intro
26. `README.md` — Phase 4 marked current

**Checkpoint H — Full verification**
27. Unit tests, full e2e suite, both builds, manual dev-server smoke test

---

## Verification

- After A: typecheck + contracts build clean; e2e still 39/39.
- After B/C/D/E: e2e green after each new spec file/assertion added.
- After F: manual verification via `pnpm dev` — create opportunity, move it
  through Kanban stages into Closed Won, see analytics reflect it, convert a
  lead and confirm the Opportunity appears; Member RBAC boundaries confirmed.
- `pnpm --filter @sales-platform/api build` and `pnpm --filter @sales-platform/web build` clean, final gate.

### Critical files
- `apps/api/src/database/schema/sales.schema.ts` (new) — foundation
- `packages/contracts/src/sales.ts` (new) — shared DTOs/schemas
- `apps/api/src/modules/sales/pipelines/pipelines.service.ts` (new) — default-pipeline seeding, stage CRUD
- `apps/api/src/modules/sales/opportunities/opportunities.service.ts` (new) — CRUD, stage-move guard, analytics queries
- `apps/api/src/modules/leads/leads/leads.service.ts` — `convert()` extended to create an Opportunity
- `packages/contracts/src/events.ts` — 4 new event types added to `TIMELINE_EVENT_TYPES`
- `apps/api/src/modules/crm/timeline/timeline.service.ts` — `summarizeEvent()` cases
- `apps/api/src/database/schema/crm.schema.ts` — `activities.opportunityId` column
- `apps/web/src/lib/nav.ts` — permission gates for Sales nav entries
