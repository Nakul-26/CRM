# ADR 0006: Support Phase 6 scope — SLA snapshotting, fixed ticket transitions, read-time breach flags, internal-only KB, event-payload-driven email dispatch

## Status

Accepted — 2026-08-16

## Context

Section 36's Phase 6 checklist is Support: Tickets, Knowledge Base, SLAs —
confirmed by the three `ComingSoon` stubs at
`apps/web/src/app/(dashboard)/support/{tickets,kb,slas}/page.tsx`, all
labeled `phase="Phase 6 (Support)"`. Separately, two prior phases left an
explicit trail pointing at this phase: the README has said since Phase 1
that Mailpit is "wired up from Phase 6 onward," and
[ADR 0005](0005-quotations-phase5-scope.md) decision #7 explicitly deferred
real SMTP dispatch for "sending" a quote to Phase 6. So this phase has two
halves — the new Support domain itself, and the first outbound email
infrastructure in the codebase — and one of the four things it ships
(quote-send email) is a change to an already-shipped Phase 5 file, not a
net-new module.

## Decisions

**1. One module, three sub-resources, folder-per-subdomain.**
`apps/api/src/modules/support/{tickets,sla-policies,kb}/`, one
`pgSchema("support")` holding all four tables (`tickets`, `ticket_comments`,
`sla_policies`, `kb_articles`). Support has three genuinely distinct
sub-resources each with real state — closer to `CrmModule`'s
folder-per-subdomain shape than `QuotesModule`'s flat layout (where
templates are a satellite of one entity, not a peer). API routes are
top-level (`/tickets`, `/sla-policies`, `/kb`), matching the
Products/Quotes precedent where the API route namespace has never been
coupled to the frontend nav grouping.

**2. Ticket status is a fixed transition graph, reusing Leads' pattern, not Opportunities'.**
`draft`-equivalent `open → [in_progress, resolved, closed]`,
`in_progress → [open, resolved, closed]`, `resolved → [open, closed]`,
`closed → [open]`. No terminal state — a closed ticket can always reopen,
unlike quotes' terminal `accepted`. Ticket status is a small closed enum,
not user-defined like Opportunity stages, so this reuses Leads'
`ALLOWED_TRANSITIONS`/`assertValidLeadTransition` pattern — the same
reasoning ADR 0005 used to pick this pattern for quote status over
Opportunities' flag-based approach.

**3. SLA due-dates are snapshotted onto the ticket at creation, not live-joined to the policy.**
`sla_policies` (`priority`, `firstResponseTargetMinutes`,
`resolutionTargetMinutes`) is a small per-org config table, one policy per
`(organizationId, priority)` (enforced by a partial unique index that
excludes soft-deleted rows, so deleting a policy and adding a replacement
for the same priority is always possible). On ticket creation, the matching
policy (if any) is looked up once and its targets become
`firstResponseDueAt`/`resolutionDueAt` timestamps on the ticket itself. A
later edit to the SLA policy never changes an already-created ticket's due
dates — the same "snapshot, not live reference" reasoning ADR 0005 used for
quote line items, applied to a new sub-feature.

**4. SLA breach is a pure, read-time computed flag — deliberately not a persisted or lazily-touched status.**
`apps/api/src/modules/support/tickets/ticket-sla.ts` exports a DB-free pure
function, `computeTicketSlaFlags(ticket, now)`, unit-tested directly (same
shape as `evaluate-lead-score.ts`/`quote-pdf.ts`). It's appended to the DTO
at serialization time and never written to the database. This is a smaller
footprint than Quotes' lazy-persisted `expired` status: nothing downstream
needs to *transition* a ticket when it becomes breached — you can still
resolve a breached ticket normally — unlike quote expiry, which is itself a
value in the fixed status enum and therefore has to be persisted somewhere.
Persisting a breach flag here would be state with no behavior depending on
it, so it stays purely computed.

**5. `support.tickets.manage` narrows to reassignment only, now that `.edit` exists.**
The permission string `support.tickets.manage` was already reserved before
this phase (with only `.view`/`.create` alongside it) — this phase adds
`.edit`/`.delete` to match every sibling domain's convention, which forces
`.manage`'s meaning to narrow to something specific rather than "everything
not view/create." It becomes the gate for `POST /tickets/:id/assign`
specifically. Status transitions and comments use `.edit`, mirroring how
`leads.controller.ts`'s `:id/qualify` route is gated by `leads.edit`, not a
separate permission — a "who owns this ticket" reassignment is a
team-lead-level action distinct from day-to-day ticket work.

**6. Knowledge Base is internal-only this phase — no public customer-facing view.**
`kb_articles` (title, globally unique `slug`, category, body, tags,
`isPublished`) is CRUD + publish/unpublish, gated exactly like every other
authenticated resource — no `PublicKbController`. Phase 6 already bundles
four sizable pieces (Tickets, SLA policies, KB, and the first-ever
mail-dispatch infrastructure); a second, distinct type of unauthenticated
public surface — with its own slug-lookup, no-auth controller, and "is this
content safe to expose externally" review — is a real, separable
increment, not a trivial add, even though `PublicQuotesController`'s
pattern is proven and reusable. `GET /public/kb`, `GET /public/kb/:slug`
(published-only, no mutation) is the natural, cheap follow-up once there's
a concrete self-service need — recorded here as a deferral, not a silent
gap. The `slug` column is globally unique (not per-org) regardless, the
same "simplest race-free, global" trade-off ADR 0005 already accepted for
quote numbering, so that follow-up needs no schema change when it happens.

**7. Email dispatch: publishing services enrich their own event payloads; the mail listener has zero service dependencies.**
`MailListener` (`apps/api/src/shared/mail/mail.listener.ts`) only reads
`event.payload` — already containing `contactEmail`/`contactName`/subject
text/links, added by whichever service published the event — and calls
`MailerService.send()`. No `CrmModule`/`SupportModule`/`QuotesModule`
imports exist anywhere in the mail path. This keeps the import graph flat
(matching `QuotesService`'s existing direct-read-not-DI precedent for
cross-schema data) and is itself a "snapshot, not live reference": the
email reflects the contact's address at the moment the triggering action
happened, not whatever it is by the time the in-process listener runs a
moment later. `MailerService`/`MailListener` live in `apps/api/src/shared/
mail/`, registered in the already-`@Global()` `SharedModule` alongside
`AuditListener` — the same cross-cutting, `@OnEvent`-driven, "never break
the triggering business operation" shape audit logging already uses,
including the identical try/catch-and-log pattern.

**8. No SMTP auth or TLS config.**
`MailerService`'s nodemailer transport is `{host, port, secure: false}` —
no credentials. This matches `docker-compose.yml`'s Mailpit service (no
auth configured) and the pre-existing minimal `SMTP_HOST`/`SMTP_PORT` env
fields (no auth vars). Real SMTP-provider auth is a future need, not a
current one — the same "don't build for a need that doesn't exist yet"
discipline used everywhere else in this codebase.

**9. This phase touches one Phase 5 file: `QuotesService.send()`.**
It gains a contact lookup (only if `quote.contactId` is set) and enriches
the `quote.sent` event payload with `contactEmail`, `contactName`, and
`publicUrl` (built from a new `WEB_APP_URL` env var + the quote's
`shareToken`). This fulfills ADR 0005's explicit deferral of real email
dispatch. Called out here explicitly so it isn't a surprise diff — every
other file this phase touches is net-new.

**10. Inbound email-to-ticket parsing is out of scope.**
`ticket_comments.authorId` is nullable in the schema, but this phase always
populates it with an internal user — there is no channel for a customer's
email reply to become a ticket comment. Building that would mean standing
up mail-receiving/parsing infrastructure and a security review of
untrusted inbound content, a materially bigger feature than this phase's
outbound-only dispatch. Recorded as an explicit scope cut, not a silent
gap.

## Consequences

- Ticket SLA targets are locked in at creation time; changing an SLA
  policy's minutes later never retroactively changes an already-open
  ticket's due dates — an explicit new policy version applies only to
  tickets created after it.
- A ticket's SLA-breach status is never stored, so it can't be filtered on
  at the database layer in this phase (e.g. "list all breached tickets"
  requires computing the flag per-row after fetching) — acceptable at this
  scale, and easy to add a persisted/indexed variant later if a dashboard
  need forces it.
- No public help-center page exists yet; a support agent must relay KB
  content to a customer manually until that's built.
- All outbound email in this system today is transactional and
  one-directional — no reply-by-email loop exists, and none is implied by
  what's shipped.
- `SMTP_FROM` and `WEB_APP_URL` are new required-by-default (but
  sensibly-defaulted) environment variables; a production deployment will
  want to override both from their `localhost`/`no-reply@` dev defaults.
