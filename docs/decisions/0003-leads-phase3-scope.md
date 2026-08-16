# ADR 0003: Leads Phase 3 scope — no Opportunity on convert, no behavioral scoring, one cross-schema transaction

## Status

Accepted — 2026-08-15

## Context

Section 7 of the product brief describes lead conversion as producing
`Lead -> Account + Contact + Opportunity`, and its example scoring rules
include behavioral signals ("visited pricing page," "downloaded brochure,"
"requested demo"). Section 36's actual Phase 3 checklist is narrower: Lead
CRUD, Lead scoring, Sources, Qualification, Conversion, Duplicate
detection. Two things in the fuller description can't be built yet, and
one implementation choice deliberately crosses a module boundary this
codebase otherwise avoids.

## Decisions

**1. Conversion creates Account + Contact only, no Opportunity.**
Sales Pipeline (Opportunities) is Phase 4 — the domain doesn't exist yet.
`LeadsService.convert()` (`apps/api/src/modules/leads/leads/leads.service.ts`)
creates/reuses an Account and Contact and marks the lead `Converted`. When
Phase 4 lands, conversion gets one more step to also create an Opportunity;
nothing about today's shape needs to change to add it.

**2. Scoring rules can't reference behavioral signals.**
`evaluate-lead-score.ts` supports rules over fields the Lead record
actually has (`companySize`, `email` — business-vs-free-provider check,
`source`, `industry`, `estimatedValue`). "Visited pricing page,"
"downloaded brochure," and "requested demo" need a web-analytics/marketing-
automation event pipeline that doesn't exist anywhere in this system's
architecture (no such service in the brief's own service list, Section 5).
Building a tracking pipeline to support three example bullet points is out
of scope for Phase 3.

**3. Lead conversion writes directly to `crm.accounts`/`crm.contacts` inside one transaction, bypassing `AccountsService`/`ContactsService`.**
`docs/architecture/overview.md` states cross-module reads go through the
other module's service and cross-module side effects go through domain
events — Phase 2's leads→crm FK already carved out a narrow, read-only
exception to that rule. Conversion needed a real exception: reusing an
existing Account/Contact instead of creating duplicates, and marking the
lead `Converted`, all had to happen atomically (a lead marked "converted"
with no Account, or an orphaned Account with no lead behind it, is a worse
failure mode than the module-boundary violation). `AccountsService`/
`ContactsService` bind their own top-level DB connection and aren't
transaction-composable, so `LeadsService.convert()` operates on the
`accounts`/`contacts` Drizzle tables directly inside one
`db.transaction()`. This is a single, documented exception, not a pattern
to repeat — see the comment directly above `convert()`.

## Consequences

- Converting a lead never produces a duplicate Account (case-insensitive
  exact name match) or Contact (case-insensitive exact email match) within
  an organization; it reuses what's already there.
- If Leads is ever split into its own deployed service (per ADR 0001's
  own trigger table), `convert()`'s direct table access becomes a call to
  the CRM service's API instead — the one place that split touches.
- No web-analytics event ingestion exists yet; scoring rules are limited
  to information already on the Lead record.
- Opportunity creation on convert is a known gap, not a bug, until Phase 4.
