# Phase 5 — Quotations (Products, Pricing, Quotes, Templates, PDF, Versioning, Sending, Acceptance)

## Context

Phases 1-4 (Identity, CRM, Leads, Sales Pipeline) are built, tested, and
running. The brief's Section 36 phased plan calls for **Phase 5 —
Quotations** next. ADR 0001 already names `quotes` and `products` as two
separate bounded domains (separate from `sales`), and `apps/web/src/lib/nav.ts`
already has two separate nav sections — "Quotations" (Quotes, Templates) and
"Products" (Products, Pricing) — both currently `ComingSoon` stubs. This
phase builds both modules for real.

This is the first phase with two new schema-owning modules at once
(`products`, `quotes`), the first genuinely **immutable/versioned document**
in the system (a sent quote's content can't silently change under the
customer), the first **PDF generation**, and the first **unauthenticated,
customer-facing endpoint** (a prospect accepting/rejecting a quote via a
share link, with no login). Everything else follows Phase 1-4 conventions
exactly: tenant-scoped services, permission-gated controllers, domain events
→ audit log, soft delete, zod contracts, `TIMELINE_EVENT_TYPES` extension.

---

## 0. Scope decisions

| Sub-feature | Decision | Reasoning |
|---|---|---|
| **Two modules, two schemas** | `apps/api/src/modules/products/` (schema `products`) and `apps/api/src/modules/quotes/` (schema `quotes`), matching ADR 0001's named module list and `nav.ts`'s two separate sections. `QuotesModule` imports `ProductsModule` (for price lookups); both directly read `crm.accounts`/`crm.contacts`/`sales.opportunities` for existence checks, same narrow cross-schema-read precedent `OpportunitiesService` already uses for accounts/contacts. |
| **Line items snapshot, not live-join** | `quote_line_items` stores its own `name`/`unitPrice`/`description` copied at add-time, plus an optional `productId` pointer (nullable, set-null on product delete). Quote totals never change because a product's price changed later. | Standard invoicing/quoting practice; mirrors the Won/Lost "flags not names" precedent — the source of truth for what the customer saw lives on the document, not on a live reference. |
| **Pricing = per-product volume tiers** | `product_price_tiers` (`productId`, `minQuantity`, `unitPrice`), a small table, not a rules engine. `ProductsService.priceFor(productId, quantity)` returns the best-matching tier price (falls back to the product's base price). The frontend uses it to *suggest* a unit price when a line item is added; the server does not force it — reps can override. | Matches Leads' scoring-rule-engine precedent (small, config-driven, not over-built) applied to a new sub-feature; avoids inventing a general discount/rules engine nothing else needs yet. |
| **Versioning: snapshot-on-revise, not snapshot-per-edit** | While a quote is `draft`, edits (`PATCH /quotes/:id`) mutate version 1 in place — no version churn for normal drafting. Once `sent` (or `accepted`/`rejected`/`expired`), the quote is locked against direct edits; the only way to change it is `POST /quotes/:id/revise`, which clones the latest version into a new version (`N+1`) and reopens status to `draft`. Old versions are kept immutably for history/PDF-of-record. | A real content-immutability need exists here that Leads/Opportunities never had (nobody emails a customer a PDF of an Opportunity). Reusing plain mutable PATCH semantics would let a quote's total silently change after being sent — this is the deliberate architectural difference from every prior module, called out explicitly rather than reused blindly. |
| **Fixed status transition graph** | `draft → sent → accepted \| rejected`, plus lazy `sent → expired` (checked/persisted on access, once `validUntil` has passed — see next row), and `sent \| rejected \| expired → draft` via `/revise`. `accepted` is terminal (no revise). Enforced by an `ALLOWED_TRANSITIONS` map. | Quote status *is* a small fixed enum (unlike Opportunity stages, which are user-defined) — this reuses Leads' `assertValidLeadTransition` pattern, not Opportunities' flag-based approach, because the two cases are genuinely different shapes. |
| **Lazy expiry, no scheduler** | No cron/Temporal job flips `sent` quotes to `expired` when `validUntil` passes. Instead, any read/write path that touches a `sent` quote past its `validUntil` transitions and persists `expired` as a side effect first ("touch-on-access"). | ADR 0001 already defers Temporal/background jobs until a real need forces it; a quote's expiry being detected "on next view" rather than to-the-minute is an acceptable, explicitly documented simplification, not a silent gap. |
| **"Sending" = share-link generation, not email dispatch** | `POST /quotes/:id/send` transitions `draft → sent` and generates a `shareToken` (opaque, unguessable UUID) if one doesn't exist yet; the response includes the public URL. No SMTP call happens. The rep copies/shares the link themselves. | The README already states Mailpit/SMTP wiring is a **Phase 6** deliverable — no email-sending code exists anywhere yet. Building real dispatch here would jump ahead of that phase. Recorded as a scope cut in the new ADR; Phase 6 is the natural place to add "email this link automatically." |
| **Public acceptance is unauthenticated by design** | `PublicQuotesController` (`@Controller("public/quotes")`), all routes `@Public()` (existing decorator, already used by `/health` and auth endpoints — first real second use). Looked up by `shareToken`, not by id/org — the token *is* the auth. `GET` works whenever a token exists; `POST .../accept` and `.../reject` only succeed from `sent` status. Publishing events from these routes passes `organizationId` explicitly (derived from the looked-up quote row) since there is no JWT/request-context to source it from — `DomainEventBus.publish()` already supports this (`organizationId` is an explicit optional param, confirmed in `domain-event-bus.ts`). | First customer-facing unauthenticated flow in the app — worth flagging as a new pattern, not a security shortcut: the token is the credential, exactly like a password-reset link. |
| **No auto-integration into Opportunity stage on acceptance** | Accepting a quote does **not** automatically move the linked Opportunity to a "won" stage. `quote.accepted` is published (and shows on the account timeline) but no cross-module write happens. | Auto-advancing a stage would require Quotes to look up the opportunity's pipeline and find a stage flagged `isWon` — real coupling into Sales' internals for a "nice to have" automation. Same reasoning ADR 0004 used to push deeper automation to Phase 8 ("Analytics & Automation") — recorded there, not silently worked around. |
| **Quote numbering: global identity column, not per-org sequence** | `quotes.sequenceNumber` — a Postgres `generatedAlwaysAsIdentity()` integer, globally increasing across all orgs (not reset per-org). Display format `Q-00001` etc. is computed at the serialization boundary from the integer, not stored twice. | Per-org-starting-at-1 numbering needs either a per-org sequence (schema complexity) or a racy `count()+1` query; a single global identity column is atomic, race-free, and still produces stable, unique, human-readable numbers — the same trade-off precedent as picking lazy pipeline-seeding over event-driven seeding in Phase 4 (simplest race-free option). |
| **PDF generated on-demand, not stored** | `pdfkit` (new dependency, pure-JS, no headless browser/binary) streams a PDF built from a quote+version+line-items+account+org snapshot directly in the HTTP response. Nothing is written to disk/S3. | ADR 0002 already established that no file-storage abstraction exists anywhere in this codebase; generating on-demand from data already in Postgres sidesteps needing one entirely, while still delivering the literal "PDF generation" checklist item. Documented as the same reasoning, applied to a new sub-feature. |
| **BFF gateway proxy needs a binary-safe path** | `apps/web/src/app/api/gateway/[...path]/route.ts` currently always does `apiRes.text()` then re-wraps as `NextResponse` — this would corrupt PDF bytes. Fix: branch on response `content-type`; for `application/pdf` (and generally anything not `application/json`/text), proxy via `arrayBuffer()`/`ReadableStream` instead of `.text()`, and forward `content-disposition` so downloads keep a sensible filename. | A necessary small fix to shared infrastructure, not a new abstraction — every previous phase's JSON-only responses never exercised this path, so the bug existed latently and is only now triggered. |

---

## 1. Data model

New file `apps/api/src/database/schema/products.schema.ts`, `pgSchema("products")`:

```ts
export const products = productsSchema.table("products", {
  id, organizationId,
  name: text().notNull(),
  sku: text(),
  description: text(),
  category: text(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  currency: text().notNull().default("USD"),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  isActive: boolean().notNull().default(true),
  createdAt, updatedAt, createdBy, updatedBy, deletedAt,
}, (t) => ({ orgIdx: index().on(t.organizationId), orgActiveIdx: index().on(t.organizationId, t.isActive) }));

export const productPriceTiers = productsSchema.table("product_price_tiers", {
  id, organizationId,
  productId: uuid().notNull().references(() => products.id, { onDelete: "cascade" }),
  minQuantity: integer().notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  createdAt, updatedAt,
}, (t) => ({ productIdx: index().on(t.productId, t.minQuantity) }));
```

New file `apps/api/src/database/schema/quotes.schema.ts`, `pgSchema("quotes")`
— imports `accounts`/`contacts` from `crm.schema.ts`, `opportunities` from
`sales.schema.ts`, `products` from `products.schema.ts`:

```ts
export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;

export const quoteTemplates = quotesSchema.table("quote_templates", {
  id, organizationId,
  name: text().notNull(),
  termsText: text(),
  defaultNotes: text(),
  defaultLineItems: jsonb().$type<TemplateLineItem[]>().notNull().default([]),
  isDefault: boolean().notNull().default(false),
  createdAt, updatedAt, createdBy, updatedBy, deletedAt,
}, (t) => ({ orgIdx: index().on(t.organizationId) }));

export const quotes = quotesSchema.table("quotes", {
  id, organizationId,
  sequenceNumber: integer("sequence_number").generatedAlwaysAsIdentity().notNull(),
  accountId: uuid().notNull().references(() => accounts.id, { onDelete: "cascade" }),
  contactId: uuid().references(() => contacts.id, { onDelete: "set null" }),
  opportunityId: uuid().references(() => opportunities.id, { onDelete: "set null" }),
  ownerId: uuid().references(() => users.id, { onDelete: "set null" }),
  templateId: uuid().references(() => quoteTemplates.id, { onDelete: "set null" }),
  status: text().notNull().default("draft"),   // QUOTE_STATUSES
  currentVersion: integer().notNull().default(1),
  currency: text().notNull().default("USD"),
  subtotal/discountTotal/taxTotal/total: numeric(12,2),   // denormalized from current version, for list/filter queries
  validUntil: timestamp({ withTimezone: true }),
  shareToken: uuid("share_token").unique(),
  notes: text(),
  sentAt, acceptedAt, rejectedAt: timestamp({ withTimezone: true }),
  createdAt, updatedAt, createdBy, updatedBy, deletedAt,
}, (t) => ({
  orgIdx: index().on(t.organizationId),
  orgStatusIdx: index().on(t.organizationId, t.status),
  accountIdx: index().on(t.accountId),
  shareTokenIdx: index().on(t.shareToken),
}));

export const quoteVersions = quotesSchema.table("quote_versions", {
  id, organizationId,
  quoteId: uuid().notNull().references(() => quotes.id, { onDelete: "cascade" }),
  versionNumber: integer().notNull(),
  subtotal/discountTotal/taxTotal/total: numeric(12,2).notNull(),
  currency: text().notNull(),
  notes: text(),
  createdAt, createdBy,
}, (t) => ({ quoteVersionIdx: index().on(t.quoteId, t.versionNumber) }));

export const quoteLineItems = quotesSchema.table("quote_line_items", {
  id, organizationId,
  quoteVersionId: uuid().notNull().references(() => quoteVersions.id, { onDelete: "cascade" }),
  productId: uuid().references(() => products.id, { onDelete: "set null" }),
  name: text().notNull(),
  description: text(),
  quantity: integer().notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
  sortOrder: integer().notNull().default(0),
}, (t) => ({ versionIdx: index().on(t.quoteVersionId, t.sortOrder) }));
```

`pnpm --filter @sales-platform/api db:generate` + `db:migrate`.

---

## 2. Contracts

`packages/contracts/src/products.ts` (new): `ProductDto`, `PriceTierDto`,
`createProductSchema`/`updateProductSchema`, `createPriceTierSchema`/
`updatePriceTierSchema`.

`packages/contracts/src/quotes.ts` (new): `QUOTE_STATUSES`/`QuoteStatus`,
`QuoteDto`, `QuoteVersionDto`, `QuoteLineItemDto`, `QuoteTemplateDto`,
`lineItemInputSchema` (`productId?`, `name`, `description?`, `quantity` (int
≥1), `unitPrice` (≥0), `discountPercent?` (0-100), `taxPercent?` (0-100)),
`createQuoteSchema` (`accountId` required, `contactId?`/`opportunityId?`/
`templateId?`/`validUntil?`/`notes?`, `lineItems: lineItemInputSchema[]`
min 1), `updateQuoteSchema` (same shape minus `accountId`, all optional —
draft-only, enforced in the service not the schema), `createTemplateSchema`/
`updateTemplateSchema`. `packages/contracts/src/index.ts` — add both exports.

---

## 3. Permissions & events

`permissions.ts` — add: `products.view`, `products.create`, `products.edit`,
`products.delete`, `products.pricing.manage`; `quotes.edit`, `quotes.delete`,
`quotes.templates.manage` (`quotes.view`/`create`/`send`/`accept` already
reserved). Member bundle gains `products.view/create/edit`, `quotes.edit`
(view/create already present); delete/pricing/templates-manage stay
Owner/Admin-only, matching every prior phase's split.

`events.ts` — new `PRODUCTS_EVENT_TYPES`/`QUOTES_EVENT_TYPES` arrays
(`product.created/updated/deleted`, `quote.created/updated/sent/accepted/
rejected/expired/revised/deleted`, `quote_template.created/updated/deleted`).
`TIMELINE_EVENT_TYPES` gains `quote.created`, `quote.sent`, `quote.accepted`,
`quote.rejected` (all payloads carry `accountId`) — third real use of that
extension point. `TimelineService.summarizeEvent()` gets matching cases.

---

## 4. Backend modules

**`apps/api/src/modules/products/`** — `products.service.ts` (`list`,
`findById`, `create`, `update`, `delete` (soft, no reference-blocking — see
scope table), `priceFor(productId, quantity)`, price-tier CRUD nested under
a product, same nesting style as Pipelines/Stages), `products.controller.ts`
(`/products`, `/products/:id`, `/products/:id/price-tiers(/:tierId)`),
`products.module.ts` (`exports: [ProductsService]`).

**`apps/api/src/modules/quotes/`**:
- `quotes.service.ts` — `list`/`findById` (serializes numerics, same
  `serializeX` helper pattern as `OpportunitiesService`, applied proactively
  here); `create` (validates account/contact/opportunity via direct reads,
  optionally pulls a template's `defaultLineItems`/`termsText`, computes
  version-1 totals, publishes `quote.created`); `update` (draft-only guard,
  replaces current version's line items wholesale, recomputes totals,
  publishes `quote.updated`); `delete` (soft, draft-only guard, `quotes.delete`);
  `send` (`ALLOWED_TRANSITIONS` guard, generates `shareToken` if absent,
  publishes `quote.sent`); `revise` (clones latest version → `N+1`, status
  back to `draft`, publishes `quote.revised`); `ensureNotExpired` (lazy
  expiry check/persist, called at the top of every read/action method);
  `versions(quoteId)`; `findByToken`/`acceptByToken`/`rejectByToken` (public
  surface — no `organizationId` param, derived from the row; explicit
  `organizationId` passed to `DomainEventBus.publish`); template CRUD
  (`listTemplates`, `createTemplate`, `updateTemplate`, `deleteTemplate`).
- `quote-pdf.ts` — pure(ish) builder function `buildQuotePdf(data: QuotePdfData): PDFKit.PDFDocument`
  taking a plain snapshot object (quote, version, line items, account,
  contact, organization name) and returning a streamable PDFKit document —
  no DB/service access, same "pure function pulled out of the service"
  precedent as `evaluate-lead-score.ts`, testable directly.
- `quotes.controller.ts` — `/quotes` (list/create), `/quotes/templates`
  (+`/:id`) declared **before** `/quotes/:id` routes in the class body (same
  "specific-before-generic" fix already applied in `leads.controller.ts`/
  `opportunities.controller.ts`), `/quotes/:id` (get/patch/delete),
  `/quotes/:id/send`, `/quotes/:id/revise`, `/quotes/:id/versions`,
  `/quotes/:id/pdf`, `/quotes/:id/versions/:versionId/pdf` (all authenticated).
- `public-quotes.controller.ts` — `@Controller("public/quotes")`, every
  route `@Public()`: `GET /:token`, `POST /:token/accept`,
  `POST /:token/reject`, `GET /:token/pdf`.
- `quotes.module.ts` — `imports: [ProductsModule]`, registers both
  controllers + service.

`app.module.ts` — import `ProductsModule` then `QuotesModule` (dependency
order), after `SalesModule`.

**Route table** (permission column omitted for public routes — none apply):

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/products` | `products.view` / `.create` |
| GET/PATCH/DELETE | `/products/:id` | `.view` / `.edit` / `.delete` |
| GET/POST/PATCH/DELETE | `/products/:id/price-tiers(/:tierId)` | `products.pricing.manage` (GET uses `.view`) |
| GET/POST | `/quotes/templates` | `quotes.view` / `.templates.manage` |
| PATCH/DELETE | `/quotes/templates/:id` | `quotes.templates.manage` |
| GET/POST | `/quotes` | `quotes.view` / `.create` |
| GET/PATCH/DELETE | `/quotes/:id` | `.view` / `.edit` / `.delete` |
| POST | `/quotes/:id/send` | `quotes.send` |
| POST | `/quotes/:id/revise` | `quotes.edit` |
| GET | `/quotes/:id/versions` | `quotes.view` |
| GET | `/quotes/:id/pdf`, `/quotes/:id/versions/:versionId/pdf` | `quotes.view` |
| GET/POST/POST/GET | `/public/quotes/:token`(`/accept`\|`/reject`\|`/pdf`) | none (`@Public()`) |

---

## 5. Cross-module & infra wiring

- `QuotesModule` imports `ProductsModule` → `QuotesService` injects
  `ProductsService` for `priceFor()` lookups when a line item references a
  `productId` (existence + suggested-price check, same DI pattern
  `ActivitiesService` already uses for `OpportunitiesService`).
- `apps/api/package.json` — add `pdfkit` + `@types/pdfkit` (devDependency).
- `apps/web/src/app/api/gateway/[...path]/route.ts` — binary-safe branch
  for non-JSON content types (PDF streaming fix, see scope table).
- `apps/web/src/middleware.ts` — add `"/public"` to `PUBLIC_PATHS`.
- Timeline: `TIMELINE_EVENT_TYPES` + `summarizeEvent()` changes from §3 —
  zero changes to the merge query itself (third proof of that extension
  point, after `lead.converted` and Phase 4's `opportunity.*` events).

---

## 6. Frontend

`apps/web/src/hooks/use-products.ts`, `use-quotes.ts` — mirror
`use-opportunities.ts`/`use-pipelines.ts` exactly (list/get/create/update/
delete + action-specific hooks like `useSendQuote`, `useReviseQuote`,
`usePriceTiers`).

`apps/web/src/components/products/product-form.tsx`,
`price-tier-editor.tsx` (inline add/edit/remove rows for a product's tiers).

`apps/web/src/components/quotes/quote-form.tsx` (account/contact/opportunity/
template selects, `validUntil`, notes) + `line-item-editor.tsx` (add/remove
rows, product picker prefills name/price/tax via `priceFor`, editable
qty/price/discount/tax, live client-side total preview mirroring the
server's formula for immediate feedback — server remains authoritative).

Pages (replacing the four `ComingSoon` stubs):
- `products/page.tsx` — list + create dialog.
- `products/[id]/page.tsx` (new) — edit form + price-tier editor.
- `products/pricing/page.tsx` — cross-product table (name, base price, tier
  count), links into each product's detail page (avoids duplicating the
  tier editor in two places).
- `quotes/page.tsx` — list (status filter) + create dialog (`QuoteForm` +
  `LineItemEditor`).
- `quotes/[id]/page.tsx` (new) — status badge, line items table, totals,
  action buttons gated by status+permission (Send/Revise/Delete), version
  history list, "Copy public link" + "Download PDF" buttons, edit dialog
  (draft-only, hidden otherwise).
- `quotes/templates/page.tsx` — list + create/edit dialog, gated
  `quotes.templates.manage`.
- `apps/web/src/app/public/quotes/[token]/page.tsx` (new, **outside** the
  `(dashboard)` route group — no sidebar, no auth) — read-only quote view +
  Accept/Reject buttons (shown only when status is `sent` and not expired)
  + Download PDF link.

`nav.ts` — add `permission: "products.view"` / `"quotes.view"` to the
relevant items (Templates uses `quotes.view` for visibility; the
manage-only actions are gated inside the page itself, same as Pipeline
management in Phase 4).

---

## 7. Sequencing (system stays runnable + tested after each checkpoint)

**A — Schema + contracts + permissions + events foundation**
`products.schema.ts`, `quotes.schema.ts` (new) + barrel; `db:generate`+`db:migrate`;
`packages/contracts/src/products.ts`, `quotes.ts` (new) + barrel; `permissions.ts`;
`events.ts` (new event arrays + `TIMELINE_EVENT_TYPES` additions).
*Verify: typecheck both packages; full e2e suite still green (49/49, nothing touched yet).*

**B — Products module, tested**
Service/controller/module; `apps/api/test/products.e2e-spec.ts` (CRUD,
soft delete, price tiers + `priceFor` tier-matching, cross-tenant 404s, RBAC).

**C — Quotes core: create/update/delete + versioning-in-place while draft, tested**
Service/controller/module (excluding send/revise/pdf/public for now);
`apps/api/test/quotes.e2e-spec.ts` — create computes totals correctly from
line items (incl. discount+tax math), draft PATCH replaces line items and
recomputes, delete blocked outside draft, cross-tenant 404s, RBAC.

**D — Status transitions: send/revise/expiry, tested**
`send`, `revise`, `ALLOWED_TRANSITIONS` guard, lazy-expiry `ensureNotExpired`;
e2e: send generates a token and locks edits (PATCH now 400s), revise from
`sent` clones into v2 and reopens draft, accepted is terminal (revise 400s),
a quote whose `validUntil` has passed flips to `expired` on next GET.

**E — Public acceptance flow, tested**
`PublicQuotesController` + `findByToken`/`acceptByToken`/`rejectByToken`;
e2e: unauthenticated GET by token works, accept/reject only succeed from
`sent`, wrong/unknown token 404s, accepting publishes `quote.accepted` with
correct `organizationId` (verify via the account's audit-log-backed timeline).

**F — PDF generation, tested**
`pdfkit` dependency; `quote-pdf.ts` (unit-tested directly, pure input →
valid PDF buffer, matching `evaluate-lead-score.spec.ts`'s precedent);
authenticated + public PDF endpoints; e2e asserts `content-type: application/pdf`
and non-trivial byte length on both endpoints.

**G — Timeline integration, tested**
`summarizeEvent()` cases; e2e: `quote.created/sent/accepted` show on the
linked account's timeline with correct summaries.

**H — Frontend**
Hooks, forms, all 6 dashboard pages + the public page; `middleware.ts`
(`/public` public path); gateway proxy binary-safe fix; `nav.ts` permission
gates.
*Verify manually via dev server*: create a product with a price tier,
create a quote referencing it, send it, open the public link in an
unauthenticated context (or incognito), accept it, confirm status/timeline
update, download the PDF from both the dashboard and the public page,
revise a sent quote and confirm v2 appears with history preserved, confirm
Member RBAC boundaries (can create/edit quotes, can't delete or manage
templates/pricing).

**I — Docs**
`docs/decisions/0005-quotations-phase5-scope.md` (new ADR, codifying every
row in §0); `docs/plans/0005-phase5-quotations-plan.md` (this plan,
persisted); `docs/architecture/overview.md` (module list, data ownership,
events, new "Phase 5 scope" section); `README.md` (Phase 5 marked current).

**J — Full verification**
Unit tests (incl. new `quote-pdf.spec.ts`), full e2e suite, both builds,
manual dev-server smoke test as in H.

---

## Verification

- After A: typecheck + contracts build clean; e2e still 49/49.
- After B-G: e2e green after each new spec file/assertion added.
- After H: manual verification via `pnpm dev` per the checklist above,
  including the unauthenticated public flow (critical — this is the one
  path with no JWT to lean on for correctness).
- `pnpm --filter @sales-platform/api build` and `pnpm --filter @sales-platform/web build` clean, final gate.

### Critical files
- `apps/api/src/database/schema/products.schema.ts`, `quotes.schema.ts` (new) — foundation
- `packages/contracts/src/products.ts`, `quotes.ts` (new) — shared DTOs/schemas
- `apps/api/src/modules/quotes/quotes.service.ts` (new) — versioning, status machine, totals math
- `apps/api/src/modules/quotes/quote-pdf.ts` (new) — pure PDF builder
- `apps/api/src/modules/quotes/public-quotes.controller.ts` (new) — unauthenticated surface
- `apps/api/src/modules/products/products.service.ts` (new) — CRUD + tiered pricing
- `apps/web/src/app/api/gateway/[...path]/route.ts` — binary-safe proxy fix
- `apps/web/src/middleware.ts` — `/public` path allowlist
- `apps/web/src/app/public/quotes/[token]/page.tsx` (new) — unauthenticated customer page
- `packages/contracts/src/events.ts` — new event types + `TIMELINE_EVENT_TYPES` additions
