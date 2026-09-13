# ADR 0021: Inbound email-to-ticket parsing — Phase 21 scope

## Status

Accepted — 2026-09-11

## Context

[ADR 0006](0006-support-phase6-scope.md) (Phase 6) built outbound-only mail
dispatch (`MailerService`/`MailListener`) and explicitly deferred the
reverse direction — its decision #10 recorded: *"Inbound email-to-ticket
parsing is out of scope. `ticket_comments.authorId` is nullable in the
schema, but this phase always populates it with an internal user — there is
no channel for a customer's email reply to become a ticket comment.
Building that would mean standing up mail-receiving/parsing infrastructure
and a security review of untrusted inbound content, a materially bigger
feature than this phase's outbound-only dispatch."*

This was the last remaining actionable (non-trigger-gated) deferred feature
in the codebase once Phase 20 (lead search frontend surface) closed the
other one. Goal: let a customer's reply to a ticket notification become a
ticket comment, without standing up a real SMTP-receiving server — not
something this (or most) deployments should build from scratch, any more
than Phase 17 built a real identity provider instead of integrating with
Keycloak.

## Decisions

**1. No real SMTP receiving server.** Inbound mail arrives via a generic,
provider-agnostic webhook, `POST /support/inbound-email`. A real deployment
points an inbound-email-parsing provider's forwarding webhook (e.g. a
Postmark or Mailgun inbound route) at this URL. This is the same "integrate
with an external system, don't build one" boundary as Keycloak/RabbitMQ/
Temporal/OpenSearch/Stripe elsewhere in this codebase.

**2. Correlation via an opaque reply token, not real email-threading
headers.** `tickets.replyToken` (a `uuid` column, generated for every
ticket at creation) is embedded in outbound ticket emails as
`Reply-To: ticket+<replyToken>@INBOUND_EMAIL_DOMAIN`. The webhook parses
this back out of the inbound payload's `to` address. Real `In-Reply-To`/
`References` header threading would require the provider to preserve and
forward those headers verbatim, which isn't guaranteed across providers —
an address-embedded token is portable to any provider's webhook shape.

**3. Token possession is the sole credential — no sender-address
verification.** This mirrors the trust model quotes' `shareToken`
([ADR 0005](0005-quotations-phase5-scope.md)) already established in this
codebase: whoever has the token can act, no further identity check. The
token only ever reaches a real customer via a legitimate outbound email
(never displayed anywhere, never guessable — a `uuid`), so its exposure is
already bounded the same way a quote's public share link is. Verifying the
inbound `from` address against the ticket's contact would add complexity
for a check this trust model doesn't otherwise require anywhere else in the
app.

**4. The webhook itself needs its own auth, unlike a token-addressed
route.** Every other public route in this codebase is public *because* a
resource-specific token in the URL/body already gates it (quotes' share
link, this phase's reply token). A webhook endpoint has no such per-request
resource token to check first — anyone could POST to it. So it's gated on a
static shared secret instead: `INBOUND_EMAIL_WEBHOOK_SECRET` (env,
optional), checked against an `x-inbound-email-secret` header.
**Unset by default → the endpoint always rejects with 401** — this feature
is fully inert until explicitly configured, the same safe-by-default
posture as every other opt-in integration in this repo
(`SEARCH_PROVIDER=opensearch`, `WORKFLOW_ENGINE=temporal`,
`AUTH_OIDC_ENABLED=true`, etc.).

**5. Idempotency via `externalMessageId`.** A new nullable
`ticket_comments.external_message_id` column, with a partial unique index
(`where external_message_id is not null` — same shape as
`sla_policies_org_priority_unique`'s partial index), means a redelivered
webhook with the same `messageId` is a no-op rather than a duplicate
comment. Webhook providers redeliver on ambiguous responses; this makes
that safe.

**6. Minimal content handling, not a real HTML sanitizer.** The webhook
prefers a `text` field; falling back to `html` runs a crude regex tag-strip
plus a handful of common entity decodes. This is "good enough for this
scope" because the result is stored as plain text like every other ticket
comment body (`ticket_comments.body`, rendered with `whitespace-pre-wrap`,
never as raw HTML) — there is no HTML-rendering surface downstream to
sanitize *for*. Truncated to the same 10,000-character max as
`createTicketCommentSchema`. A body that's empty after this processing is
discarded (logged, not stored) rather than creating an empty comment.

**7. A new `ticket_comments.source` column, not "authorId is null" as the
signal.** `authorId` being null is already overloaded — it also happens
when a comment's original author user is later deleted
(`onDelete: "set null"`). `source: "internal" | "inbound_email"` is
unambiguous. An inbound-email comment always has `authorId: null`,
`isPublic: true`, `source: "inbound_email"`.

**8. Inbound comments never bump `firstRespondedAt`, but always reopen a
resolved/closed ticket.** `firstRespondedAt` specifically means "staff
responded" (Phase 6's SLA semantics); a customer's own reply isn't that.
Reopening reuses the existing "always reopenable" transition graph
(`assertValidTicketTransition`) — a customer replying to a resolved ticket
realistically means it isn't resolved.

**9. `MailListener` must never echo a reply back to its own sender.**
`onTicketCommentAdded` already skips non-public comments; it now also skips
any comment with `source: "inbound_email"`, so a customer's reply is never
mailed back to them as "Update on your support ticket."

**10. An unmatchable token or empty body still acks 200.** A webhook
returning a non-2xx status invites the calling provider to retry; neither
"this token doesn't exist" nor "this body was empty" will ever succeed on
retry, so acking prevents pointless redelivery storms. Both cases are
logged for operator visibility.

**11. Smallest necessary frontend touch.** `TicketCommentDto` gained
`source`; `TicketCommentThread` shows "Customer email reply" in place of
"Public reply" when `source === "inbound_email"`. No new page — a webhook
has no UI of its own, and every other ticket surface (list, detail, status
actions) is unaffected.

## Consequences

- A customer can now reply to a ticket-created or ticket-commented email
  and have that reply appear as a comment on the ticket, reopening it if it
  had been resolved/closed — closing the gap ADR 0006 decision #10 named.
- This is fully inert in any environment that doesn't set
  `INBOUND_EMAIL_WEBHOOK_SECRET` — no behavior changes for outbound mail,
  and the new endpoint always 401s.
- The trust model (token possession only, no sender verification) matches
  quotes' existing `shareToken` pattern rather than introducing a new,
  stricter standard only this feature would follow — consistent, not
  necessarily maximally defensive; documented here as a deliberate choice.
- No real SMTP-receiving infrastructure was built; a production deployment
  still needs a real inbound-email-parsing provider configured to forward
  to this webhook, the same "you still need the real external system"
  caveat as Keycloak/RabbitMQ/Temporal/OpenSearch.
