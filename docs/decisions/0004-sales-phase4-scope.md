# ADR 0004: Sales Phase 4 scope — no Products/Attachments on Opportunity, unconstrained `opportunity_id`, deeper analytics deferred to Phase 8

## Status

Accepted — 2026-08-15

## Context

Section 8 of the product brief describes an Opportunity as supporting
`Products` and `Attachments` alongside the fields Phase 4 actually
implements, and Section 21 lists a fuller set of dashboard/reporting
metrics than a single Forecast page can reasonably cover. Section 36's
actual Phase 4 checklist is narrower: Opportunities, Pipelines, Stages,
Kanban, Forecast, Activities, Analytics. Two things from the fuller
description can't be built yet, and one schema choice deliberately skips a
foreign-key constraint this codebase otherwise adds by default.

## Decisions

**1. Opportunities don't model Products (line items) or Attachments.**
The Product Catalog (`sales.schema.ts`'s `opportunities` table has no
`products` column) is Phase 5 territory (Section 36) — the domain doesn't
exist yet, same reasoning ADR 0003 used to defer Opportunity creation
itself until this phase existed. Attachments need file-upload/storage
infrastructure that doesn't exist anywhere in this codebase yet (no
S3/local-storage abstraction in any phase so far), and isn't in Phase 4's
own checklist — only in Section 8's fuller feature list. Both are scope
cuts, not gaps to silently work around.

**2. `crm.activities.opportunity_id` has no database-level foreign key.**
`apps/api/src/database/schema/sales.schema.ts` already imports
`accounts`/`contacts` from `crm.schema.ts` for the Opportunity's own FKs.
Adding a DB-level FK from `crm.schema.ts` back to `sales.schema.ts` for
`activities.opportunity_id` would be a circular file import between the
two schema modules. The column is a plain `uuid` instead, validated at the
application layer (`ActivitiesService.create()` calls
`OpportunitiesService.findById()`, which 404s for a missing or
cross-tenant id) — the same precedent already set by the unconstrained
`created_by`/`updated_by` columns elsewhere in this codebase.

**3. Deeper dashboards/reporting stay out of the Forecast page.**
The brief's Phase 4 checklist item "Analytics" is satisfied by
`GET /opportunities/stats/summary` (pipeline value, weighted pipeline,
win rate, average deal size, average sales cycle, sales velocity, won/lost
revenue) and `GET /opportunities/stats/forecast` (grouped by expected-close
month), both surfaced on `/sales/forecast`. Section 36 dedicates all of
Phase 8 ("Analytics & Automation") to "Dashboards, Reports... Forecasting"
— building a fuller reporting UX now would be building into a phase that
doesn't exist yet.

**4. Lead conversion now creates an Opportunity, closing ADR 0003's deferred item.**
`LeadsService.convert()` (`apps/api/src/modules/leads/leads/leads.service.ts`)
now also inserts a `sales.opportunities` row — against the org's default
pipeline and its first stage — inside the same transaction that
creates/reuses the Account and Contact. This extends the existing
documented exception from ADR 0003 (direct cross-schema writes inside one
transaction, bypassing the owning module's service, for atomicity) rather
than introducing a new one. `LeadsModule` imports `SalesModule` to get
`PipelinesService.getOrCreateDefault()`/`firstStage()`, both read-only
lookups called before the transaction opens (that method runs its own
transaction internally when it needs to seed defaults, so it can't be
nested inside `convert()`'s).

## Consequences

- Converting a Qualified lead now produces Account + Contact + Opportunity,
  matching the brief's Section 7 conversion spec in full.
- An opportunity's activities are scoped tighter than "everything on the
  account" (an account can have several concurrent opportunities), reusing
  Phase 2's `crm.activities` table rather than a parallel one — at the cost
  of one unconstrained FK, mitigated by an application-layer existence check.
- No line items or file attachments exist on an Opportunity yet — both
  known gaps, not bugs, until Phase 5 (products) and whenever file-storage
  infrastructure is introduced.
- `/sales/forecast` covers the numbers a salesperson needs day-to-day;
  configurable dashboards, saved reports, and cross-entity analytics wait
  for Phase 8.
