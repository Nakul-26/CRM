# ADR 0019: Notification preferences + email digest — Phase 19 scope

## Status

Accepted — 2026-09-05

## Context

[ADR 0009](0009-notifications-phase9-scope.md) (Phase 9) built the in-app
notification bell for a bounded set of 7 events
(`ticket.assigned`, `opportunity.won`/`lost`, `quote.accepted`/`rejected`,
`payment.succeeded`/`failed`), each with exactly one recipient. It explicitly
deferred, as decision #8: *"delivery preferences/settings, an email digest of
notifications, a global 'notify on every event' firehose"* — recorded as a
deliberate cut, with the note *"a future phase should scope that explicitly
if it's ever needed."*

This phase was chosen directly by the user from three candidate deferred
features, after all five of ADR 0001's originally-deferred infrastructure
items (RabbitMQ, OpenSearch, Temporal, Keycloak, the microservices split)
were completed through Phase 18. Today, the 7 notification event types are
in-app only; email today happens only for a disjoint set of event types via
`MailListener` (`quote.sent`, `ticket.created`, etc. — see
[ADR 0006](0006-support-phase6-scope.md)). This phase adds an opt-in email
channel for the notification event types specifically, without touching
either of those existing, separate systems.

## Decisions

**1. One global delivery mode per user, not a 7-way matrix.**
`emailDelivery: "off" | "immediate" | "daily_digest"`, one field, defaulting
to `"off"` — byte-for-byte today's behavior until a user opts in. Per-event-
type granularity (e.g. "email me for ticket assignments but not opportunity
outcomes") would be real added complexity — a wider schema, a matrix-shaped
settings UI — for no evidenced need. Recorded as a deliberate cut, matching
this project's "smallest change that satisfies the deferral" discipline.

**2. In-app notifications are never gated by this preference.** The
preference only controls whether an *additional* email is also sent —
there's no way to mute the bell/notification list itself. Building that
wasn't asked for and wasn't part of ADR 0009's deferral.

**3. Not ported to `apps/notifications-service`.** Phase 18's opt-in
microservices split ([ADR 0018](0018-microservices-split-phase18-scope.md))
extracted `notifications` as a proof of the extraction pattern, explicitly
"opt-in... no other module has a concrete need yet" — that service is off by
default and isn't held to full feature parity with the in-process module.
Preferences and the digest job are built only in `apps/api`'s
`NotificationsModule`. If the split is ever turned on for real, porting this
feature there is separate, named follow-up work, not a silent gap.

**4. Digest cadence is fixed, not per-user configurable.**
`NotificationDigestScheduler` runs `@Cron("0 8 * * *")`, once daily — same
proportionality call as `RenewalsScheduler`'s fixed `*/15 * * * *`. A
per-user schedule picker is real added scope for no evidenced need.

**5. Digest idempotency via a `digestSentAt` column, not a separate queue
table.** `notifications` gained a nullable `digestSentAt` timestamp.
`NotificationDigestService.sendDueDigests()` selects undigested rows for
every `daily_digest`-mode user, sends one email per user, then stamps
`digestSentAt = now()` on exactly the rows it just sent. A user in
`"immediate"` mode never touches this column — the two modes are mutually
exclusive by construction (one enum field), so there's no double-send risk
between them, and no separate "already sent" ledger was needed.

**6. Best-effort, non-blocking mail, same posture as `MailListener`/
`AuditListener`.** `NotificationsService.create()` always inserts the in-app
row first; only after that succeeds does it check the preference and
attempt an email, wrapped in try/catch — a mail failure is logged and
swallowed, never breaks notification creation. `NotificationDigestService`
processes one user's batch at a time with its own try/catch, so one user's
send failure doesn't block the rest of that day's batch — the same
"swallow one item, keep the batch going" shape as
`DunningScheduler.processDueCycles()`.

**7. `MailerService` is now exported from `SharedModule`.** It was a
provider there but not in the `exports` array — every prior email path
(`MailListener`) lived inside `SharedModule` itself, so this was never
needed before. `NotificationsService`/`NotificationDigestService` are the
first consumers outside that module.

**8. First `onConflictDoUpdate` in this codebase.**
`NotificationsService.setPreferences()` upserts via Drizzle's
`onConflictDoUpdate`, targeting a new unique index on
`(organizationId, userId)` — existing precedent
(`roles.service.ts`/`teams.service.ts`) only ever needed
`onConflictDoNothing`. This is the documented, correct Drizzle API for
"insert, or update if a preference row already exists."

**9. Reached via a topbar link, not `NAV_SECTIONS`.**
`apps/web/src/lib/nav.ts` is explicitly "the full information architecture
from Section 22 of the brief" — not the right home for a setting that isn't
part of that IA. The new `/settings/notifications` page is instead linked
from `AppTopbar`'s right-hand actions group, next to the existing
`NotificationBell`/username/Sign-out — the same "authenticated user, not
brief-IA" precedent the bell itself set in Phase 9.

**10. Plain `useState` form, no new UI primitive or validation library.**
No `select`/`radio` component exists yet in `apps/web/src/components/ui/`,
and no react-hook-form/zod-resolver is used anywhere in this frontend; the
new settings page uses native `<input type="radio">` elements and the
existing `Button`/`Card` primitives, matching
`administration/teams/page.tsx`'s plain-`useState`-form pattern rather than
introducing a new frontend convention for one page.

**11. `create()`'s email dispatch is fire-and-forget, not awaited.**
`ticket.assigned` and the other 6 notification event types are consumed by
a fire-and-forget `EventEmitter2.emit()` in `DomainEventBus.publish()` (not
`emitAsync()`), so notification creation was already only eventually
consistent with the HTTP request that triggered it — a pre-existing,
previously-observed source of occasional full-suite-load flakiness in
`notifications.e2e-spec.ts`, unrelated to this phase. The first version of
`create()` written for this phase awaited the whole preference-check/email
chain, which added a second DB round trip's worth of latency to *every*
notification created — including the overwhelming default `"off"` case
that never sends mail — measurably widening that pre-existing race window.
Fixed by making the email dispatch (`dispatchImmediateEmail`) a genuinely
non-blocking, internally-caught background operation: `create()` now
resolves as soon as the in-app insert does, exactly matching its
pre-Phase-19 timing, regardless of what preference (if any) the recipient
has set.

## Consequences

- A user can now opt in to an email for the same 7 notification events the
  bell already shows them — immediately, or batched into one daily digest —
  without any change to the default (in-app only, `"off"`) experience for
  everyone who never visits the new settings page.
- `apps/api/src/modules/notifications/` gained its first unit-test coverage
  (`notifications.service.spec.ts`, `notification-digest.service.spec.ts`)
  — previously this module was e2e-only.
- The "email digest of notifications" and "delivery preferences/settings"
  items ADR 0009 deferred are now resolved; the "global notify on every
  event firehose" idea it also named stays deferred and untouched — this
  phase did not expand which events create a notification.
- If `apps/notifications-service` (Phase 18) is ever turned on in a real
  deployment, it does not have preferences/digest support — a named,
  deliberate gap (decision #3 above), not a silent one.
