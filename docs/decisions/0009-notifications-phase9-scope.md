# ADR 0009: Notifications Phase 9 scope — a bounded, event-driven in-app notification center

## Status

Accepted — 2026-08-18

## Context

Unlike every prior phase, **no ADR, plan, or `ComingSoon` stub names "Phase
9"** anywhere in the repo. The same breadcrumb search used to synthesize
Phase 8's scope came up empty this time — checked every ADR, every plan doc,
ADR 0001's original module list, and every `ComingSoon` page. Rather than
inventing a scope, this was flagged to the user directly, offering the two
items that do have some evidence:

- The `notifications` module — named in ADR 0001's original aspirational
  module list (`... Product, Notification, Audit, Workflow, Identity`),
  explicitly deferred with no phase assignment in
  [ADR 0008](0008-analytics-automation-phase8-scope.md) decision #10, and
  with a live in-code breadcrumb: `apps/web/src/app/(dashboard)/administration/users/page.tsx`
  shows an invited user's one-time temporary password with the comment *"a
  real notification service replaces this in a later phase."*
- The Audit Log UI — still a literal `ComingSoon` stub
  (`apps/web/src/app/(dashboard)/administration/audit/page.tsx`, tagged
  "Phase 2+ (audit UI)").

The user chose the Notifications module.

## Decisions

**1. A new top-level `apps/api/src/modules/notifications/` module, owning a
brand-new `notifications` Postgres schema — one table.**
The first wholly new schema-owning module since Phase 7's `subscriptions`,
matching ADR 0001's "one module = one schema = one owner" rule.

**2. In-app notifications only, for a bounded, evidenced set of 5 existing
events — no new event types.**
`ticket.assigned` (recipient = `payload.assigneeId`, already present),
`opportunity.won`/`opportunity.lost` (recipient = the opportunity's
`ownerId` — a new payload field added at the two publish sites in
`opportunities.service.ts`), `quote.accepted`/`quote.rejected` (recipient =
the quote's `ownerId` — a new payload field added at the two publish sites
in `quotes.service.ts`). These are exactly the events in the codebase today
that already carry a single, clear "this person should know" recipient —
every other domain event is either not owner-scoped or self-evidently
already visible to its actor. Same "publishing services enrich their own
event payloads with everything the listener needs" precedent `MailListener`
already established, and the same precedent Phase 8 used to add
`opportunityId` to `quote.accepted`. A "notify on every event" firehose was
considered and rejected as unbounded scope creep — the same discipline ADR
0008 applied to keep Analytics' metrics to exactly 7 fields.

**3. Skip when the recipient is null, or when `actorId === recipientId`.**
Don't notify a user of their own action. This interacts cleanly with Phase
8's automation: `autoAdvanceOnQuoteAccepted`'s `opportunity.won` publish has
no `actorId` (system-triggered, per ADR 0008 decision #6), so the skip never
suppresses it — the opportunity owner always gets notified when a
customer's quote acceptance auto-closes their deal, exactly the case where
they most need to know.

**4. `NotificationsListener` lives inside the `notifications` module itself,
not `SharedModule`.**
It reacts to events published by `SalesModule` and `QuotesModule` with no
import relationship to either — the same precedent Phase 8's
`QuoteAcceptedListener` already proved: `@nestjs/event-emitter`'s bus is
process-global, so a listener's module placement doesn't gate which events
it receives, only whether Nest instantiates it at all (guaranteed here since
`NotificationsModule` is imported into `AppModule`). `MailListener`/
`AuditListener` live in `SharedModule` because they are *unboundedly*
cross-cutting (audit literally listens to every event); `NotificationsListener`
is bounded to 5 specific events for its own module's purpose, so keeping it
self-contained — no `SharedModule` edit required — is the better-fitting
precedent, same reasoning that put `QuoteAcceptedListener` in `SalesModule`
rather than `SharedModule`. Best-effort throughout: caught and logged, never
rethrown into the request path — the same posture every `@OnEvent` listener
in this codebase already uses.

**5. Authenticated-only API, no new permission — every query is scoped to
`userId = current user`.**
Direct precedent: `GET /auth/me` requires JWT auth but has no
`@RequirePermissions` — self-scoped-by-construction data doesn't need an
org-wide permission gate. This is the first resource in the app that is
user-scoped rather than org-scoped; recorded here explicitly as a new (but
directly precedented) pattern, not a gap.

**6. Four endpoints, no pagination.** `GET /notifications` (optional
`?unreadOnly=true`, newest-first, capped at 50), `GET
/notifications/unread-count`, `PATCH /notifications/:id/read`, `POST
/notifications/read-all`. No endpoint in the app paginates today; a flat
50-row cap keeps the list bounded without introducing a new pattern.
`PATCH .../:id/read` 404s (not 403s) on a notification that isn't the
caller's own — the same cross-tenant/cross-owner 404 posture used
everywhere else.

**7. Frontend: a bell icon in `AppTopbar`, polled, not pushed.**
`AppTopbar` had a bare, unused left-hand slot (`{/* Global search lands here
in a later phase */}`, still untouched — out of scope here) and nothing in
its right-hand actions group beyond the username/sign-out controls; the bell
goes there. Unread count is polled via TanStack Query `refetchInterval`
(30s) rather than pushed over a WebSocket/SSE — no new transport
infrastructure, the same "avoid new infra unless a concrete need forces it"
call ADR 0001 made, and the same choice already made for Phase 7's
renewal-reminder job (a Postgres table + scheduled poll, not a message
queue).

**8. Not built: delivery preferences/settings, an email digest of
notifications, a global "notify on every event" firehose.**
Recorded explicitly as a deferral — the same "record every cut, don't
silently build or silently skip" discipline every prior ADR here has
followed. An email digest specifically is `MailListener`'s territory and
already handled per-event where it matters (e.g. `ticket.created`); this
module doesn't duplicate that.

## Consequences

- Assigning a ticket, closing an opportunity, or a customer accepting/
  rejecting a quote now creates a notification for the right person — and
  never for the person who just took the action themself.
- The dashboard topbar has a working bell with a live unread badge on every
  authenticated page.
- No delivery-preferences UI exists yet — a future phase should scope that
  explicitly if it's ever needed, rather than it arriving as a side effect
  of another phase.
- `notifications` module (ADR 0001's original module list) is now fully
  resolved — nothing named in that original list remains unassigned to a
  phase.
