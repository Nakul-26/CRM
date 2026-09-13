# Phase 21 — Inbound email-to-ticket parsing

## Context

This is the last remaining actionable (non-trigger-gated) deferred feature
in the codebase. [ADR 0006](../decisions/0006-support-phase6-scope.md)
decision #10 explicitly recorded: *"Inbound email-to-ticket parsing is out
of scope... Building that would mean standing up mail-receiving/parsing
infrastructure and a security review of untrusted inbound content, a
materially bigger feature than this phase's outbound-only dispatch."*
`ticket_comments.authorId` was left nullable specifically so a
customer-authored comment (no internal user) could exist later.

Goal: let a customer's email reply to a ticket notification become a
ticket comment, closing that named gap — without standing up a real
SMTP-receiving server (out of scope for a local dev environment; every
other "avoid infra we can't run here" precedent in this codebase, e.g.
Keycloak/RabbitMQ/Temporal/OpenSearch, treats an external system boundary
as the thing to integrate with, not to build).

## Findings from exploration

- **Outbound mail today**: `MailerService` (`apps/api/src/shared/mail/mailer.service.ts`)
  wraps nodemailer, pointed at Mailpit, no auth. `MailListener`
  (`apps/api/src/shared/mail/mail.listener.ts`) is a cross-cutting
  `@OnEvent`-driven listener (same shape as `AuditListener`) reacting to
  `quote.sent`, `ticket.created`, `ticket.comment_added` (only when
  `isPublic`), `subscription.renewal_reminder_sent`. Publishing services
  enrich their own event payloads with everything the email needs
  (recipient email/name) — the listener has no DB/service dependencies.
- **Tickets** (`apps/api/src/modules/support/tickets/tickets.service.ts`):
  `create()` publishes `ticket.created`; `addComment()` publishes
  `ticket.comment_added` and bumps `firstRespondedAt` on the first public
  comment. Status is a fixed, always-reopenable transition graph
  (`assertValidTicketTransition`, `ALLOWED_TRANSITIONS` — `resolved`/`closed`
  can always go back to `open`).
- **Schema** (`apps/api/src/database/schema/support.schema.ts`):
  `ticketComments.authorId` is nullable (`onDelete: "set null"`) — already
  reserved for a non-staff-authored comment, per ADR 0006 decision #10.
- **Existing token-based public-access precedent**: quotes' `shareToken`
  (`apps/api/src/database/schema/quotes.schema.ts`, a `uuid` column,
  `quotes.service.ts:304` `quote.shareToken ?? randomUUID()`) is the
  established pattern in this codebase for "possession of an opaque token
  is the credential" — no further identity check. Reused directly rather
  than inventing sender-address verification: the token only ever reaches a
  real customer via a legitimate outbound email, so its exposure is already
  bounded the same way a quote's share link is.
- **Existing webhook precedent**: `PaymentsController`
  (`apps/api/src/modules/payments/payments.controller.ts`) has a
  `POST /payments/webhook` route using `@Public()` (bypasses
  `JwtAuthGuard`/`PermissionsGuard`) plus Stripe's own signature-verification
  header checked against `STRIPE_WEBHOOK_SECRET`. Mirrored for the new
  inbound-email webhook, using a shared-secret header instead of an HMAC
  signature (no real provider integrated here, same "mock provider, real
  wiring" spirit as `PAYMENT_PROVIDER=mock`).
- **e2e env-setup idiom** (`apps/api/test/setup/test-app.ts`): every
  optional/opt-in env var is set via `??=` so a spec-local override wins.
  `INBOUND_EMAIL_WEBHOOK_SECRET`/`INBOUND_EMAIL_DOMAIN` added there the same
  way `STRIPE_WEBHOOK_SECRET` already is.
- **Pure-logic-extracted-and-unit-tested precedent**: `ticket-sla.ts`/
  `ticket-sla.spec.ts` and `evaluate-lead-score.ts`. Followed the same shape
  for the token-parsing/HTML-stripping helpers.

## Scope decisions

See [ADR 0021](../decisions/0021-inbound-email-ticket-parsing-phase21-scope.md)
for the full record. Summary:

1. No real SMTP receiving server — a generic webhook, `POST
   /support/inbound-email`, stands in for a real inbound-email-parsing
   provider's forwarding call.
2. Correlation via an opaque `tickets.replyToken` embedded in the
   `Reply-To` address of outbound ticket emails
   (`ticket+<replyToken>@INBOUND_EMAIL_DOMAIN`), parsed back out by the
   webhook.
3. Token possession is the sole credential — no sender-address
   verification, matching quotes' `shareToken` trust model.
4. The webhook itself needs its own static shared secret
   (`INBOUND_EMAIL_WEBHOOK_SECRET`) — unset by default, so the endpoint
   always 401s until explicitly configured.
5. Idempotency via a partial-unique `ticketComments.externalMessageId`.
6. Minimal content handling: prefer `text`, crude tag-strip of `html` as a
   fallback, truncate to 10,000 chars, discard if empty.
7. New `ticketComments.source` column (`"internal" | "inbound_email"`) —
   not derived from `authorId` being null, which is already overloaded by
   deleted-user comments.
8. Inbound comments never bump `firstRespondedAt`; they always reopen a
   resolved/closed ticket.
9. `MailListener` never echoes an inbound reply back to its own sender.
10. An unmatchable token or empty body still acks 200 (no retries for a
    permanently-unprocessable delivery).
11. Smallest necessary frontend touch: a "Customer email reply" label in
    the existing `TicketCommentThread`, no new page.

## Implementation

- **Schema**: `tickets.replyToken` (uuid, not null, unique index,
  `$defaultFn(() => randomUUID())`); `ticketComments.source` (text, default
  `"internal"`) and `ticketComments.externalMessageId` (nullable text,
  partial unique index). Migration generated via `pnpm --filter
  @sales-platform/api db:generate`, then hand-adjusted (see Verification
  findings) to backfill safely, then applied via `db:migrate`.
- **Config**: `INBOUND_EMAIL_DOMAIN` (defaulted) and
  `INBOUND_EMAIL_WEBHOOK_SECRET` (optional) added to `packages/config/src/env.ts`,
  `apps/api/.env.example`, and `apps/api/test/setup/test-app.ts`.
- **`MailerService.send`**: gained optional `replyTo`.
- **`MailListener`**: `TicketCreatedPayload`/`TicketCommentAddedPayload`
  gained `replyTo`/`source`; `onTicketCommentAdded` now also skips
  `source === "inbound_email"` so a reply is never echoed back.
- **`TicketsService`**: injects `ConfigService<ApiEnv, true>`; a private
  `buildReplyTo(replyToken)` builds the `ticket+<token>@domain` address;
  `create()`/`addComment()` include it in their published payloads. New
  `addInboundEmailComment(replyToken, { body, externalMessageId })` looks
  the ticket up by token alone, handles idempotency, inserts the comment,
  reopens a resolved/closed ticket, and publishes `ticket.comment_added`
  with no `contactEmail`/`replyTo` (so nothing emails the customer back).
- **New `inbound-email.ts`**: pure `extractReplyToken`/`extractCommentBody`
  helpers, unit-tested in `inbound-email.spec.ts`.
- **New `inbound-email.controller.ts`/`inbound-email.service.ts`**: the
  `@Public()` webhook route (secret-header check, then delegates to the
  service) and its thin orchestration layer. Registered in
  `support.module.ts`.
- **Contracts**: `TicketCommentDto.source`, `TICKET_COMMENT_SOURCES`,
  `inboundEmailWebhookSchema`/`InboundEmailWebhookInput`.
- **Frontend**: `TicketCommentThread`'s label logic gained the
  `source === "inbound_email"` case.

## Docs

- [ADR 0021](../decisions/0021-inbound-email-ticket-parsing-phase21-scope.md).
- This plan, persisted.
- `docs/architecture/overview.md` — new "Phase 21 scope" section; Phase 6's
  section text gets a one-line "Resolved in Phase 21" pointer.
- `README.md` — Phase 21 marked current.

## Verification

1. `pnpm --filter @sales-platform/api db:generate`, then inspected the
   generated SQL before applying.
2. `pnpm typecheck` (monorepo-wide).
3. `pnpm build` (monorepo-wide).
4. New `apps/api/test/inbound-email.e2e-spec.ts` (401 without/with wrong
   secret; correct token + text body creates an `inbound_email`-sourced
   public comment without bumping `firstRespondedAt`; a resolved ticket
   reopens on reply; a redelivered `messageId` is idempotent; an unknown
   token acks 200 with no comment created; an html-only body has its tags
   stripped).
5. New `apps/api/src/modules/support/tickets/inbound-email.spec.ts` for the
   two pure helpers.
6. Re-ran `apps/api/test/ticket-comments.e2e-spec.ts` and
   `apps/api/test/tickets.e2e-spec.ts` for regressions.
7. Full `apps/api` unit + e2e suites, and monorepo build, as the closing
   regression pass.

### Verification findings

`pnpm typecheck` (9/9) and `pnpm build` (6/6, including a real Next.js
production build and a real `nest build` for the API) both clean. The
generated migration (`0013_melodic_arachne.sql`) was hand-adjusted before
applying: drizzle-kit's default `ADD COLUMN "reply_token" uuid NOT NULL`
would fail against a `tickets` table that already has rows (no SQL-level
default, only an app-level `$defaultFn`), so it was split into add-nullable
→ backfill with `gen_random_uuid()` → `SET NOT NULL`. Applied cleanly to
the dev DB with no errors.

The new `inbound-email.spec.ts` (pure helpers): 11/11. The new
`inbound-email.e2e-spec.ts`: the first isolated run was 7/7 green. It then
failed 4/7 when re-run as part of the full e2e suite — traced (not a code
bug) to the e2e spec itself hardcoding literal `messageId` values
(`"msg-1"`, `"msg-2"`, etc.) that collided with rows a *previous* run of
the same file had already inserted into the shared, not-reset-between-runs
test database — `externalMessageId`'s uniqueness is intentionally global
(a real Message-ID is globally unique per RFC 5322), so
`addInboundEmailComment` was correctly rejecting the second run's identical
IDs as duplicates. Fixed by adding a `uniqueMessageId()` test helper
(mirroring the existing `uniqueEmail()` pattern already used everywhere
else in this test suite for exactly this reason) and re-verified clean
across three consecutive standalone runs (7/7 each) against the same
persistent test DB. Re-ran `ticket-comments.e2e-spec.ts` +
`tickets.e2e-spec.ts` together: 10/10, no regression.

Full `apps/api` unit suite: 27/27 suites, 156/156 tests, clean (up from
Phase 20's 26/145 — the new `inbound-email.spec.ts` suite included).

A first full e2e suite run (34 suites) showed the fixed-at-the-time
messageId-collision failures above plus the by-now-expected
`search-opensearch.e2e-spec.ts` timeout (documented in Phase 20's own
verification findings as pre-existing, load-dependent flakiness). After the
messageId fix, a **third** full e2e run showed severe, wide-scale
degradation — 16/34 suites failed, many with per-suite times in the
thousands of seconds (one reported 14855s — over 4 hours) and a handful of
raw `ECONNRESET`/`CONNECTION_ENDED` errors, spanning suites with no
plausible relationship to this phase's diff (quotes, subscriptions, CRM
contacts/accounts, sales, audit-log SSE, KB articles). Investigated rather
than dismissed: `docker ps` showed all 8 containers still "healthy" and
Postgres's `pg_stat_activity` count was stable at 70/100 (not climbing,
ruling out a connection leak); a fresh, immediately-following targeted run
of exactly this phase's specs (`inbound-email` + `ticket-comments` +
`tickets`) came back instantly normal — 3/3 suites, 17/17 tests, 48.97s
wall-clock, matching the very first clean run's pace almost exactly. That
combination — stable connections, healthy containers, near-simultaneous
multi-thousand-second readings across unrelated suites, then an immediate
return to normal — is the signature of the host machine itself
suspending/sleeping for an extended period mid-run (idle-laptop power
management), not a resource leak this diff introduced or a real regression
in any of the affected suites. Not chased further: repeatedly re-running
the full 34-suite suite to chase a single fully-clean pass was itself
consuming hours per attempt and risked compounding host load rather than
diagnosing anything new; the targeted, diff-relevant regression coverage
above is complete and green.

## Critical files
- `apps/api/src/database/schema/support.schema.ts`
- `apps/api/src/database/migrations/0013_melodic_arachne.sql` (new,
  hand-adjusted for safe backfill)
- `apps/api/src/modules/support/tickets/tickets.service.ts`
- `apps/api/src/modules/support/tickets/inbound-email.ts` (new)
- `apps/api/src/modules/support/tickets/inbound-email.service.ts` (new)
- `apps/api/src/modules/support/tickets/inbound-email.controller.ts` (new)
- `apps/api/src/modules/support/support.module.ts`
- `apps/api/src/shared/mail/mailer.service.ts`
- `apps/api/src/shared/mail/mail.listener.ts`
- `packages/config/src/env.ts`
- `packages/contracts/src/support.ts`
- `apps/web/src/components/support/ticket-comment-thread.tsx`
- `apps/api/test/inbound-email.e2e-spec.ts` (new)
- `apps/api/src/modules/support/tickets/inbound-email.spec.ts` (new)
- `docs/decisions/0021-inbound-email-ticket-parsing-phase21-scope.md` (new)
