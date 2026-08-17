# Phase 6 — Support (Tickets, SLAs, Knowledge Base) + Email Dispatch

## Context

Phases 1-5 (Identity, CRM, Leads, Sales Pipeline, Quotations) are built,
tested, and running. The three `ComingSoon` stubs at
`apps/web/src/app/(dashboard)/support/{tickets,kb,slas}/page.tsx` are all
labeled `phase="Phase 6 (Support)"`, and `apps/web/src/lib/nav.ts` already
has a "Support" section grouping them — confirming Phase 6 is Support:
Tickets, Knowledge Base, SLAs. Separately, `README.md` states "Mailpit (dev
email capture, wired up from Phase 6 onward)", and
[ADR 0005](../decisions/0005-quotations-phase5-scope.md) decision #7
explicitly deferred real SMTP dispatch for "sending" a quote to Phase 6
("Phase 6 is the natural place to add 'and also email this link
automatically'"). So this phase has two halves: the new Support domain
itself, and finally wiring up the email infrastructure two prior phases
have been pointing at (`docker-compose.yml`'s `mailpit` service and
`SMTP_HOST`/`SMTP_PORT` env vars have existed since Phase 1 but nothing
sends mail yet).

This is the first phase with **outbound transactional email**, and it
touches one already-shipped Phase 5 file (`QuotesService.send()`) as well
as the new Support module — flagged explicitly below so it isn't a
surprise diff. Everything else follows Phase 1-5 conventions: tenant-scoped
services, permission-gated controllers, domain events → audit log, soft
delete, zod contracts, fixed-status-transition-graph precedent (Leads),
`TIMELINE_EVENT_TYPES` extension (fourth use, after `lead.converted`,
`opportunity.*`, `quote.*`).

---

## 0. Scope decisions

| Sub-feature | Decision | Reasoning |
|---|---|---|
| **One module, three sub-resources** | `apps/api/src/modules/support/{tickets,sla-policies,kb}/`, one `pgSchema("support")` holding all four tables (`tickets`, `ticket_comments`, `sla_policies`, `kb_articles`), one `support.module.ts` wiring three services/controllers. | Support has three genuinely distinct sub-resources each with real state — closer to `CrmModule`'s folder-per-subdomain shape than to `QuotesModule`'s flat layout (where templates are a satellite of one entity). |
| **Top-level API routes, not nested under `/support`** | `/tickets`, `/sla-policies`, `/kb` — matching Products/Quotes precedent, where the API route namespace has never been coupled to the frontend nav grouping (`/products`, `/quotes` are top-level even though `nav.ts` groups them under "Products"/"Quotations"). | Consistency with every prior phase; no reason to special-case Support. |
| **Ticket status is a fixed transition graph** | `open → [in_progress, resolved, closed]`, `in_progress → [open, resolved, closed]`, `resolved → [open, closed]`, `closed → [open]`. No terminal state — a closed ticket can always reopen (unlike quotes' terminal `accepted`). | Ticket status is a small closed enum, not user-defined like Opportunity stages — reuses Leads' `ALLOWED_TRANSITIONS`/`assertValidLeadTransition` pattern, the correct fit here (same reasoning ADR 0005 used for quote status). |
| **Line items snapshot pattern reused for SLA due-dates** | `sla_policies` (`priority`, `firstResponseTargetMinutes`, `resolutionTargetMinutes`) is a small per-org config table, one policy per `(organizationId, priority)` (unique index). On ticket creation, the matching policy (if any) is looked up once and its targets are snapshotted onto the ticket as `firstResponseDueAt`/`resolutionDueAt` timestamps. A later edit to the SLA policy never changes an already-created ticket's due dates. | Same "snapshot, not live reference" reasoning ADR 0005 used for quote line items, applied to a new sub-feature. |
| **SLA breach is a pure, read-time computed flag — not a persisted/lazily-touched status** | `apps/api/src/modules/support/tickets/ticket-sla.ts` exports a DB-free pure function `computeTicketSlaFlags(ticket, now)` returning `{firstResponseBreached, resolutionBreached}`, unit-tested directly (same shape as `evaluate-lead-score.ts`/`quote-pdf.ts`). Appended to the DTO at serialization time; never written to the database. | Deliberately a smaller footprint than Quotes' lazy-persisted `expired` status: nothing downstream needs to *transition* on an SLA breach (you can still resolve a breached ticket normally), unlike quote expiry which is itself a value in the fixed status enum. Persisting it would be state with no behavior depending on it. |
| **`support.tickets.manage` narrows to reassignment only** | The already-reserved `support.tickets.manage` permission (pre-dating `.edit`, which is added this phase) becomes specifically the `POST /tickets/:id/assign` gate. Status transitions and comments use `.edit`, mirroring how `leads.controller.ts`'s `:id/qualify` route is gated by `leads.edit`, not a separate permission. | A "who owns this ticket" reassignment is a team-lead-level action distinct from day-to-day ticket work (commenting, transitioning status) — same class of split Quotes used between `.edit` (draft mutation) and `.send`/`.templates.manage` (distinct actions). |
| **Knowledge Base is internal-only this phase — no public customer-facing view** | `kb_articles` (title, globally-unique `slug`, category, body, tags, `isPublished`) is CRUD + publish/unpublish, gated exactly like every other authenticated resource. No `PublicKbController`. | Phase 6 already bundles four sizable pieces (Tickets, SLA policies, KB, and the first-ever mail-dispatch infrastructure). A second, distinct type of unauthenticated public surface — with its own slug-lookup, no-auth controller, and "is this content safe to expose externally" review — is a real, separable increment, not a trivial add, even though `PublicQuotesController`'s pattern is proven and reusable. Recorded as an explicit scope cut in the new ADR: `GET /public/kb`, `GET /public/kb/:slug` (published-only, no mutation) is the natural, cheap follow-up once there's a concrete self-service need. |
| **`kb_articles.slug` is globally unique, not per-org** | Plain `unique()` on the column, generated from title client-side or server-validated, no per-org namespacing. | Same "simplest race-free, global" trade-off ADR 0005 already accepted for quote numbering — avoids a two-segment identifier for a feature that isn't even public-facing yet. |
| **Email dispatch: publishing services enrich their own event payloads; the mail listener has zero service dependencies** | `MailListener` only reads `event.payload` (already containing `contactEmail`/`contactName`/subject text/links, added by whichever service published the event) and calls `MailerService.send()`. No `CrmModule`/`SupportModule`/`QuotesModule` imports anywhere in the mail path. | Keeps the import graph flat (matches `QuotesService`'s existing direct-read-not-DI precedent for cross-schema data) and is itself a "snapshot, not live reference" — the email reflects the contact's address *at the moment the triggering action happened*, not whatever it is by the time the in-process listener runs. |
| **Mail infra lives in `apps/api/src/shared/mail/`, registered in `SharedModule`** | `MailerService` + `MailListener` sit alongside `AuditListener` (which already does the exact "cross-cutting, `@OnEvent`-driven, never break the triggering operation" thing this needs). | Nothing feature-specific needs to inject `MailerService` directly (yet) — it's cross-cutting infrastructure, structurally identical to audit logging, not a new feature module. |
| **No SMTP auth / TLS config** | `MailerService`'s nodemailer transport is `{host, port, secure: false}` — no credentials. | Matches `docker-compose.yml`'s Mailpit service (no auth configured) and the existing minimal `SMTP_HOST`/`SMTP_PORT` env fields (no auth vars). Real SMTP-provider auth is a future need, not a current one — same discipline as every other deferred-until-needed piece in this codebase. |
| **This phase touches one Phase 5 file: `QuotesService.send()`** | Adds a contact lookup (only if `quote.contactId` is set) and enriches the `quote.sent` payload with `contactEmail`, `contactName`, `publicUrl` (built from a new `WEB_APP_URL` env var). Fulfills ADR 0005's explicit deferral. | Called out explicitly so it isn't a surprise diff — everything else this phase is net-new files. |
| **Inbound email-to-ticket parsing is out of scope** | `ticket_comments.authorId` is nullable in the schema but always populated by an internal user this phase — there is no channel for a customer's email reply to become a ticket comment. | Materially bigger infra (mail receiving/parsing, security review of untrusted inbound content) — explicit scope cut, not a silent gap. |

---

## 1. Data model

New `apps/api/src/database/schema/support.schema.ts`, `pgSchema("support")`
— imports `accounts`/`contacts` from `crm.schema.ts`, `users` from
`identity.schema.ts`:

```ts
export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export const slaPolicies = supportSchema.table("sla_policies", {
  id, organizationId,
  name: text().notNull(),
  priority: text().notNull(),                      // TICKET_PRIORITIES
  firstResponseTargetMinutes: integer().notNull(),
  resolutionTargetMinutes: integer().notNull(),
  createdAt, updatedAt, createdBy, updatedBy, deletedAt,
}, (t) => ({
  orgIdx: index().on(t.organizationId),
  orgPriorityUnique: uniqueIndex().on(t.organizationId, t.priority),
}));

export const tickets = supportSchema.table("tickets", {
  id, organizationId,
  subject: text().notNull(),
  description: text(),
  status: text().notNull().default("open"),         // TICKET_STATUSES
  priority: text().notNull().default("medium"),     // TICKET_PRIORITIES
  accountId: uuid().notNull().references(() => accounts.id, { onDelete: "cascade" }),
  contactId: uuid().references(() => contacts.id, { onDelete: "set null" }),
  assigneeId: uuid().references(() => users.id, { onDelete: "set null" }),
  slaPolicyId: uuid().references(() => slaPolicies.id, { onDelete: "set null" }),
  firstResponseDueAt: timestamp({ withTimezone: true }),   // snapshot at creation
  resolutionDueAt: timestamp({ withTimezone: true }),      // snapshot at creation
  firstRespondedAt: timestamp({ withTimezone: true }),
  resolvedAt: timestamp({ withTimezone: true }),
  createdAt, updatedAt, createdBy, updatedBy, deletedAt,
}, (t) => ({
  orgIdx: index().on(t.organizationId),
  orgStatusIdx: index().on(t.organizationId, t.status),
  accountIdx: index().on(t.accountId),
  assigneeIdx: index().on(t.assigneeId),
}));

export const ticketComments = supportSchema.table("ticket_comments", {
  id, organizationId,
  ticketId: uuid().notNull().references(() => tickets.id, { onDelete: "cascade" }),
  authorId: uuid().references(() => users.id, { onDelete: "set null" }),
  body: text().notNull(),
  isPublic: boolean().notNull().default(true),
  createdAt,
}, (t) => ({ ticketIdx: index().on(t.ticketId, t.createdAt) }));

export const kbArticles = supportSchema.table("kb_articles", {
  id, organizationId,
  title: text().notNull(),
  slug: text().notNull().unique(),
  category: text(),
  body: text().notNull(),
  tags: jsonb().$type<string[]>().notNull().default([]),
  isPublished: boolean().notNull().default(false),
  publishedAt: timestamp({ withTimezone: true }),
  createdAt, updatedAt, createdBy, updatedBy, deletedAt,
}, (t) => ({ orgIdx: index().on(t.organizationId), slugIdx: index().on(t.slug) }));
```

Add `relations(...)` exports per table (ticket ↔ comments/account/contact/
assignee/slaPolicy). Barrel-export from
`apps/api/src/database/schema/index.ts`.
`pnpm --filter @sales-platform/api db:generate` + `db:migrate`.

---

## 2. Contracts

`packages/contracts/src/support.ts` (new): `TICKET_STATUSES`/`TicketStatus`,
`TICKET_PRIORITIES`/`TicketPriority`, `TicketDto` (includes computed
`firstResponseBreached`/`resolutionBreached`), `TicketCommentDto`,
`SlaPolicyDto`, `KbArticleDto`; `createTicketSchema` (`subject`, `accountId`
required, `contactId?`/`priority?` default `"medium"`/`description?`),
`updateTicketSchema` (subject/description/priority, partial),
`updateTicketStatusSchema` (`{status}`), `assignTicketSchema`
(`{assigneeId: string | null}`), `createTicketCommentSchema`
(`{body, isPublic?}` default `true`), `createSlaPolicySchema`/
`updateSlaPolicySchema`, `createKbArticleSchema`/`updateKbArticleSchema`
(`slug` required, validated `[a-z0-9-]+`). `packages/contracts/src/index.ts`
— add export.

---

## 3. Permissions & events

`permissions.ts` — extend reserved list to: `support.tickets.view/create/
edit/delete/manage` (add `.edit`/`.delete`; `.manage` narrows to
assign-only per §0), `support.sla_policies.view/manage` (new, small-config
single-bucket like `products.pricing.manage`), `support.kb.view/create/
edit/delete` (new). Member bundle gains `support.tickets.edit` (can work/
comment/transition their own tickets) and `support.kb.view` (read-only
reference access); `.delete`/`.manage`/`sla_policies.*`/`kb.create|edit|
delete` stay Owner/Admin-only, matching every prior phase's split.

`events.ts` — new `SUPPORT_EVENT_TYPES`: `ticket.created/updated/
status_changed/assigned/comment_added/deleted`, `sla_policy.created/
updated/deleted`, `kb_article.created/updated/published/deleted` —
appended after `QUOTES_EVENT_TYPES`. `TIMELINE_EVENT_TYPES` gains
`ticket.created`, `ticket.status_changed`, `ticket.comment_added` (payloads
carry `accountId`) — fourth real use of the extension point
`timeline.service.ts`'s doc comment already names ("tickets" is explicitly
called out there). `TimelineService.summarizeEvent()` gets matching cases.

---

## 4. Backend modules

`apps/api/src/modules/support/`:
- `sla-policies/sla-policies.service.ts` + `.controller.ts` — CRUD;
  org+priority uniqueness enforced by the DB unique index, caught and
  translated to a 409 on violation; `findByPriority(organizationId,
  priority)` used by `TicketsService`.
- `tickets/tickets.service.ts` — `list`/`findById` (serializes + appends
  SLA flags via `ticket-sla.ts`); `create` (validates account/contact via
  direct reads — same narrow cross-schema-read precedent `QuotesService`
  already uses; looks up the matching SLA policy by priority via injected
  `SlaPoliciesService`, snapshots due-at timestamps if found; publishes
  `ticket.created` with `accountId`, `contactId`, `contactEmail`,
  `contactName`); `update` (subject/description/priority); `updateStatus`
  (`ALLOWED_TRANSITIONS` guard, stamps `resolvedAt` on transition into
  `resolved`, clears it on transition out, publishes
  `ticket.status_changed`); `assign` (publishes `ticket.assigned`);
  `delete` (soft); `addComment` (inserts; stamps `firstRespondedAt` on the
  ticket the first time an `isPublic: true` comment is added — no-op if
  already set; publishes `ticket.comment_added` with `accountId`,
  `contactEmail`, `contactName`, `body`, `isPublic`); `listComments`.
- `tickets/ticket-sla.ts` — pure `computeTicketSlaFlags()` +
  `ticket-sla.spec.ts` (unit test, DB-free).
- `kb/kb-articles.service.ts` + `.controller.ts` — CRUD; `publish`/
  `unpublish` actions setting `isPublished`+`publishedAt`.
- `support.module.ts` — registers all three controllers/services;
  `TicketsService` constructor-injects `SlaPoliciesService` (same-module
  DI, same shape `LeadsService` already uses for sibling services).

`app.module.ts` — import `SupportModule` after `QuotesModule`.

**Route table:**

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/tickets` | `support.tickets.view` / `.create` |
| GET/PATCH/DELETE | `/tickets/:id` | `.view` / `.edit` / `.delete` |
| POST | `/tickets/:id/status` | `support.tickets.edit` |
| POST | `/tickets/:id/assign` | `support.tickets.manage` |
| GET/POST | `/tickets/:id/comments` | `.view` / `.edit` |
| GET/POST | `/sla-policies` | `support.sla_policies.view` / `.manage` |
| PATCH/DELETE | `/sla-policies/:id` | `support.sla_policies.manage` |
| GET/POST | `/kb` | `support.kb.view` / `.create` |
| GET/PATCH/DELETE | `/kb/:id` | `.view` / `.edit` / `.delete` |
| POST | `/kb/:id/publish`, `/kb/:id/unpublish` | `support.kb.edit` |

---

## 5. Cross-module & infra wiring

- No new module imports anywhere — `SupportModule` reads
  `crm.accounts`/`crm.contacts` directly (same precedent `QuotesModule`
  already set); `MailListener` has zero DB/service dependencies beyond
  `MailerService`.
- `apps/api/package.json` — add `nodemailer` (dependency) +
  `@types/nodemailer` (devDependency).
- `packages/config/src/env.ts` — add to `apiEnvSchema`:
  `SMTP_FROM: z.string().default("no-reply@sales-platform.local")`,
  `WEB_APP_URL: z.string().url().default("http://localhost:3000")`.
  `apps/api/.env.example` gets both new lines.
- `apps/api/src/shared/mail/mailer.service.ts` — wraps
  `nodemailer.createTransport({host, port, secure: false})` (host/port
  from `ConfigService<ApiEnv, true>`, confirmed already the working
  injection pattern via `AuthService`'s use of it); exposes
  `send({to, subject, html, text})`; no-ops with a debug log if `to` is
  falsy (the "ticket/quote has no contact" case).
- `apps/api/src/shared/mail/mail.listener.ts` — three `@OnEvent(...)`
  handlers (`quote.sent`, `ticket.created`, `ticket.comment_added` filtered
  to `isPublic`), each wrapped in try/catch with the `AuditListener`-style
  comment adapted ("Email dispatch must never break the business operation
  that triggered it"), builds subject/HTML from the payload, calls
  `MailerService.send()`.
- `apps/api/src/shared/shared.module.ts` — add `MailerService`,
  `MailListener` to `providers`.
- `apps/api/src/modules/quotes/quotes.service.ts`'s `send()` — inject
  `ConfigService<ApiEnv, true>`; add a contact lookup (only if
  `quote.contactId` is set) and enrich the `quote.sent` payload with
  `contactEmail`, `contactName`, `publicUrl` (built from `WEB_APP_URL` +
  `shareToken`).
- Timeline: `TIMELINE_EVENT_TYPES` + `summarizeEvent()` changes from §3 —
  zero changes to the merge query itself.

---

## 6. e2e mailer strategy — real Mailpit, no mocks

`apps/api/test/setup/mailpit.ts` (new): `MAILPIT_URL` (default
`http://localhost:8025`); `clearMailpit()` → `DELETE
{MAILPIT_URL}/api/v1/messages` (called at the top of each mail-asserting
test for isolation, same instinct as the per-run test DB); `waitForMessage
(predicate, timeoutMs = 5000)` → polls `GET {MAILPIT_URL}/api/v1/messages`
every ~250ms via `fetch` until a message matching `predicate` appears or
throws on timeout — consistent with this codebase's "test against real
infra, not mocks" convention (already used for Postgres).

New `apps/api/test/mail.e2e-spec.ts`:
- `ticket.created` with a contact that has an email → assert a message
  lands addressed to that contact, subject/body reference the ticket.
- `ticket.comment_added`: a public comment triggers a second email; an
  internal (`isPublic: false`) comment does **not** (short capped
  poll-with-timeout expecting nothing).
- `quote.sent` with a contact set → assert an email lands whose body
  contains the public URL/`shareToken`.
- "No contact" case for each trigger → the triggering operation still
  succeeds and no email is attempted (the regression case that most needs
  coverage, since `send()` must no-op cleanly on a null `to`).

This suite requires the `mailpit` service from `docker-compose.yml` running
locally — same operational precondition the Postgres-backed e2e suite
already has, just extended to a second container. Note this explicitly in
the final docs update.

---

## 7. Frontend

`apps/web/src/hooks/use-tickets.ts`, `use-sla-policies.ts`, `use-kb.ts` —
mirror `use-quotes.ts` exactly (list/get/create/update/delete + action
hooks: `useUpdateTicketStatus`, `useAssignTicket`, `useTicketComments`,
`useAddTicketComment`; equivalent CRUD for SLA policies/KB articles).

`apps/web/src/components/support/ticket-form.tsx`,
`ticket-comment-thread.tsx` (list + add-comment form with an "internal
note" toggle), `sla-policy-form.tsx`, `kb-article-editor.tsx` (title/slug/
category/tags/body + publish toggle).

Pages (replacing the three `ComingSoon` stubs, plus two new detail pages):
- `support/tickets/page.tsx` — list (status/priority filters) + create
  dialog.
- `support/tickets/[id]/page.tsx` (new) — status badge + SLA breach
  indicators, comment thread, status-transition buttons, assignee picker
  (gated `support.tickets.manage`).
- `support/slas/page.tsx` — SLA policy list + create/edit dialog, gated
  `support.sla_policies.manage` for mutation.
- `support/kb/page.tsx` — article list (published/draft filter) + create
  dialog.
- `support/kb/[id]/page.tsx` (new) — editor + publish/unpublish action.

`nav.ts` — add `permission: "support.tickets.view"`, `"support.kb.view"`,
`"support.sla_policies.view"` to the three existing Support items, fixing
the pre-existing gap where they were the only nav items with no permission
gate at all.

---

## 8. Sequencing checkpoints (system stays runnable + tested after each)

**A — Schema + contracts + permissions + events foundation.**
`support.schema.ts` (new, all 4 tables) + barrel; `db:generate`+
`db:migrate`; `packages/contracts/src/support.ts` (new) + barrel;
`permissions.ts`; `events.ts` (`SUPPORT_EVENT_TYPES` + `TIMELINE_EVENT_TYPES`
additions).
*Verify: typecheck both packages; full e2e suite still green, nothing
touched yet.*

**B — SLA policies module, tested.**
Service/controller/module; `apps/api/test/sla-policies.e2e-spec.ts` (CRUD,
org+priority uniqueness → 409, cross-tenant 404s, RBAC).

**C — Tickets core: CRUD + SLA snapshot + status transitions + assignment, tested.**
`tickets.service.ts`, `ticket-sla.ts` + `ticket-sla.spec.ts`, controller,
`support.module.ts` wiring `SlaPoliciesService` in;
`apps/api/test/tickets.e2e-spec.ts` (create snapshots due-at from matching
policy; create with no matching policy leaves due-at null;
`ALLOWED_TRANSITIONS` guard rejects invalid transitions; assign; breach
flags computed correctly for overdue tickets; cross-tenant 404s; RBAC incl.
`.manage`-gated assign).

**D — Ticket comments, tested.**
`addComment`/`listComments`, `firstRespondedAt` stamp-once logic; e2e:
first public comment stamps `firstRespondedAt`, later ones don't re-stamp,
internal comments never stamp it, `isPublic` round-trips correctly.

**E — KB module, tested.**
CRUD + publish/unpublish; `apps/api/test/kb.e2e-spec.ts` (CRUD, global slug
uniqueness conflict, publish sets `publishedAt`, RBAC).

**F — Timeline integration, tested.**
`summarizeEvent()` cases; e2e: `ticket.created`/`ticket.status_changed`/
`ticket.comment_added` show on the linked account's timeline with correct
summaries (extends `crm-timeline.e2e-spec.ts` — fourth proof of that
extension point).

**G — Mail infrastructure, tested against real Mailpit.**
`nodemailer` dependency; `SMTP_FROM`/`WEB_APP_URL` env additions;
`MailerService`/`MailListener` in `shared/mail/`, registered in
`SharedModule`; `apps/api/test/setup/mailpit.ts` helper.
*Verify with a minimal smoke test: publish a raw test event manually,
confirm a message lands in Mailpit and is fetchable via its REST API.*

**H — Wire triggers into producers, tested end-to-end.**
Enrich `ticket.created`/`ticket.comment_added` payloads in
`TicketsService` (already has contact rows from validation); enrich
`quote.sent` in `QuotesService.send()` (new contact lookup + `WEB_APP_URL`-
built link — the one Phase 5 file this phase touches).
`apps/api/test/mail.e2e-spec.ts` — the full scenario set from §6.

**I — Frontend.**
Hooks, forms, all 5 dashboard pages; `nav.ts` permission gates.
*Verify manually via dev server*: create a ticket against an account with
a contact that has an email, confirm the Mailpit web UI
(`localhost:8025`) shows the confirmation email; transition status through
the full graph including a reopen; add a public and an internal comment
and confirm only the public one triggers a second email; create an SLA
policy, create a new ticket at that priority, confirm due-at snapshots and
breach indicators after the target time passes; publish a KB article; send
a quote with a contact and confirm the email in Mailpit contains a working
public link; confirm Member RBAC boundaries (can edit/comment/transition,
can't reassign, delete, or manage SLA policies/KB).

**J — Docs + full verification.**
`docs/decisions/0006-support-phase6-scope.md` (new ADR, codifying every §0
row incl. the public-KB deferral and the SLA-breach footprint call);
`docs/plans/0006-phase6-support-plan.md` (this plan, persisted);
`docs/architecture/overview.md` update (module list, data ownership,
events, new "Phase 6 scope" section); `README.md` — Phase 6 marked
current, Mailpit line updated from "wired up from Phase 6 onward" to
reflect it's now wired up. Full unit + e2e suite (incl. `ticket-sla.spec.ts`,
`mail.e2e-spec.ts`), both builds, manual smoke test as in I — final gate.

---

## Verification

- After A: typecheck + contracts build clean; e2e suite unchanged and green.
- After B-H: e2e green after each new spec file is added; from G onward
  this requires `docker compose up -d` to include the `mailpit` service
  (already defined, just now actually exercised by tests).
- After I: manual verification via `pnpm dev`, checking real emails in the
  Mailpit web UI — the one path with no way to assert correctness purely
  from HTTP response codes.
- `pnpm --filter @sales-platform/api build` and
  `pnpm --filter @sales-platform/web build` clean, final gate.

### Critical files
- `apps/api/src/database/schema/support.schema.ts` (new) — foundation for all four tables
- `packages/contracts/src/support.ts` (new) — shared DTOs/schemas
- `apps/api/src/modules/support/tickets/tickets.service.ts` (new) — SLA snapshot, status graph, comment/firstRespondedAt logic
- `apps/api/src/modules/support/tickets/ticket-sla.ts` (new) — pure breach-computation function
- `apps/api/src/shared/mail/mailer.service.ts` + `mail.listener.ts` (new) — email dispatch infrastructure, global via `SharedModule`
- `apps/api/src/modules/quotes/quotes.service.ts` (existing) — `send()` gains contact lookup + enriched payload
- `packages/contracts/src/events.ts` (existing) — `SUPPORT_EVENT_TYPES` + `TIMELINE_EVENT_TYPES` additions
- `packages/config/src/env.ts` (existing) — `SMTP_FROM`, `WEB_APP_URL`
- `apps/api/test/setup/mailpit.ts` (new) — real-infra e2e polling helper
- `apps/web/src/lib/nav.ts` (existing) — fixes the pre-existing missing-`permission` gap on the three Support items
