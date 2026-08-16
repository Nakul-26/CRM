# ADR 0005: Quotations Phase 5 scope — share-link sending, lazy expiry, snapshot-on-revise versioning, on-demand PDF, no auto-integration into Opportunity stage

## Status

Accepted — 2026-08-16

## Context

Section 36's Phase 5 checklist is Quotations: Products, Pricing, Quotes,
Templates, PDF generation, Versioning, Sending, Acceptance. Unlike Phases
2-4, this phase introduces genuinely new kinds of problems this codebase
hasn't faced yet: a document whose content must stop changing once a
customer has seen it, a PDF rendering pipeline, and — for the first time —
an endpoint a customer can reach with no login at all. Several of these
needed a real design decision rather than a direct copy of an existing
pattern, and two brief-adjacent features (real email dispatch, auto-moving
an Opportunity's stage on acceptance) turned out to depend on
infrastructure or coupling this phase deliberately doesn't introduce.

## Decisions

**1. Two new modules/schemas: `products` and `quotes`, not folded into `sales`.**
ADR 0001 already names `quotes` and `products` as separate bounded domains
from `sales`, and `apps/web/src/lib/nav.ts`'s information architecture
(Section 22) has always had them as separate top-level sections. `quotes`
imports `products` (for tiered-price lookups) and directly reads
`crm.accounts`/`crm.contacts`/`sales.opportunities` for existence checks —
the same narrow cross-schema-read precedent `OpportunitiesService` already
used for its own account/contact validation.

**2. Quote line items snapshot product data; they don't live-join it.**
`quote_line_items` stores its own `name`/`unitPrice`/`description`, copied
at the time a line item is added, plus an optional `productId` pointer
(`ON DELETE SET NULL`). A price change on a product — or the product being
deleted entirely — never retroactively changes an existing quote's total.
This is the same "flags/snapshot, not a live reference" reasoning Phase 4
used for Won/Lost (stage flags, not name-matching), applied to a case where
the customer-facing document itself is the thing that must stay stable.

**3. Pricing is per-product volume tiers, not a rules engine.**
`product_price_tiers` (`productId`, `minQuantity`, `unitPrice`) is a small
table; `ProductsService.priceFor()` picks the best-matching tier or falls
back to the base price. It's exposed read-only via
`GET /products/:id/price?quantity=N` purely to let the frontend *suggest* a
price when a rep adds a line item — the server never enforces it, since a
rep can always override the unit price on a quote. This mirrors Leads'
scoring-rule-engine precedent (small, config-driven, no attempt to build a
general discounting engine nothing else needs yet).

**4. Versioning is snapshot-on-revise, not snapshot-per-edit.**
While a quote is `draft`, `PATCH /quotes/:id` mutates version 1 in place —
ordinary drafting doesn't create version churn. Once a quote is `sent` (or
`accepted`/`rejected`/`expired`), it is locked against direct edits; the
only way to change it is `POST /quotes/:id/revise`, which clones the latest
version into version `N+1` and reopens the quote as `draft`. Old versions
are retained immutably, each independently downloadable as a PDF
(`GET /quotes/:id/versions/:versionNumber/pdf`). This is a deliberate
departure from every previous module's plain-mutable-PATCH pattern: nobody
emails a customer a PDF of an Opportunity, but a quote's whole purpose is
to be a document someone else relies on not silently changing underneath
them.

**5. Quote status is a fixed, small transition graph — unlike Opportunity stages.**
`draft → sent → accepted | rejected`, plus `sent → expired` (see below),
and `sent | rejected | expired → draft` via `/revise`; `accepted` is
terminal. This reuses Leads' `assertValidLeadTransition`-style fixed
`ALLOWED_TRANSITIONS` map, not Opportunities' flag-based approach —
Opportunity stages are user-defined and can't have a fixed graph, but a
quote's status genuinely is a small closed enum, so the simpler, older
pattern is the correct fit here, not a default reuse of whichever pattern
was most recent.

**6. Quote expiry is lazy ("touch-on-access"), not scheduler-driven.**
No cron/Temporal job flips a `sent` quote to `expired` when its
`validUntil` passes. `QuotesService`'s internal `expireIfDue()` check runs
at the top of every read/action path and persists the transition (plus
publishes `quote.expired`) the first time an expired quote is touched.
ADR 0001 already defers background job infrastructure until a concrete
need forces it; a quote showing as `expired` "as of next view" rather than
to-the-minute is an explicit, acceptable simplification for this phase, not
a silently-accepted gap.

**7. "Sending" generates a share link; it does not send an email.**
`POST /quotes/:id/send` moves `draft → sent` and generates an opaque
`shareToken` (a UUID) if the quote doesn't already have one — the response
includes enough to build the public URL, and the rep copies/shares it
themselves. The README has stated since Phase 1 that Mailpit/SMTP wiring is
a Phase 6 deliverable; no email-dispatch code exists anywhere in this
codebase yet. Building real dispatch here would be building ahead of the
phase that owns it. Phase 6 is the natural place to add "and also email
this link automatically."

**8. Quote acceptance is the first unauthenticated, customer-facing surface — and that's intentional, not a shortcut.**
`PublicQuotesController` (`GET/POST /public/quotes/:token`, `/accept`,
`/reject`, `/pdf`) uses the existing `@Public()` decorator (previously only
exercised by `/health` and the auth endpoints) and looks a quote up by its
`shareToken` — never by `id` plus a JWT. The token *is* the credential,
exactly like a password-reset link; there is no organization or user
context on this path at all. Because `DomainEventBus.publish()` needs an
`organizationId` and there is no request context to source one from on an
unauthenticated route, `QuotesService`'s public methods derive it from the
looked-up quote row and pass it explicitly — `publish()` already supported
this as an optional override, so no change to the event bus was needed.

**9. Accepting a quote does not automatically move its linked Opportunity's stage.**
`quote.accepted` is published and shows on the account timeline, but no
write happens against `sales.opportunities`. Auto-advancing a stage would
require Quotes to look up the opportunity's pipeline and find whichever
stage is flagged `isWon` — real coupling into Sales' internals to save one
manual click. ADR 0004 already pushed this class of automation
("deeper... automation") to Phase 8; this is the same call applied here,
not a silently-dropped feature.

**10. Quote numbering is a single global identity column, not a per-org sequence.**
`quotes.sequence_number` is a Postgres `GENERATED ALWAYS AS IDENTITY`
integer, incrementing across the whole platform rather than restarting at 1
per organization. The human-readable `quoteNumber` (`"Q-00001"`) is
computed from it at the serialization boundary, not stored redundantly. A
true per-org sequence starting at 1 would need either a second sequence
object per organization or a racy `count() + 1` query; a single global
identity column is atomic and race-free by construction, at the cost of
quote numbers not restarting per org — the same "pick the simplest
race-free option" reasoning Phase 4 used when choosing lazy default-pipeline
seeding over event-driven seeding.

**11. PDFs are generated on demand; nothing is written to disk or object storage.**
`pdfkit` (pure JS, no headless browser) builds a PDF directly from a
quote+version+line-items+account+org snapshot and streams it in the HTTP
response (`quote-pdf.ts`'s `buildQuotePdf()`, a pure function over plain
data — same "pure builder pulled out of the service" precedent as
`evaluate-lead-score.ts`, and directly unit-tested the same way). ADR 0002
already established that no file-storage abstraction exists anywhere in
this codebase; generating on-demand from data already in Postgres sidesteps
needing one entirely while still shipping the literal "PDF generation"
checklist item.

**12. The BFF gateway proxy needed a binary-safe path — a necessary fix, not a new abstraction.**
`apps/web/src/app/api/gateway/[...path]/route.ts` always called
`apiRes.text()` before this phase, which silently corrupts binary bytes by
re-encoding them as UTF-8. Every previous phase's responses were JSON-only,
so this bug existed but was never triggered. The proxy now branches on
response `content-type`: JSON/text bodies still go through `.text()`,
everything else (PDFs) goes through `.arrayBuffer()`, and
`content-disposition` is forwarded so downloads keep a sensible filename.

## Consequences

- A sent quote's numbers cannot silently change; any post-send correction
  is an explicit, auditable new version via `/revise`.
- No real email is sent when a quote is "sent" — reps share the link
  manually until Phase 6 wires up SMTP dispatch.
- A quote's `expired` status can lag its actual `validUntil` moment by up
  to the time until its next read/action — acceptable at this scale, not
  hidden.
- Accepting a quote is a fully anonymous action from the server's point of
  view beyond the token; anyone holding the link can accept or reject —
  matching how a password-reset or unsubscribe link already works
  elsewhere on the web, and explicitly not a broader authorization gap.
- Quote numbers are globally, not per-org, sequential — cosmetic only, no
  functional impact, and easy to change later if a customer ever needs
  per-org numbering.
- Opportunity stage automation on quote acceptance, real email dispatch,
  and deeper dashboards/reporting all remain explicit gaps for Phase 6/8,
  not silent omissions.
