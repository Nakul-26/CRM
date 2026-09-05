# Phase 19 — Notification preferences + email digest

## Context

This feature was chosen directly by the user from three candidate deferred
features, after all five of [ADR 0001](../decisions/0001-modular-monolith.md)'s
originally-deferred infrastructure items were completed through Phase 18.

[ADR 0009](../decisions/0009-notifications-phase9-scope.md) (Phase 9)
explicitly deferred, as decision #8: *"delivery preferences/settings, an
email digest of notifications, a global 'notify on every event' firehose"* —
recorded as a deliberate cut, with the note *"a future phase should scope
that explicitly if it's ever needed."* Today, `NotificationsListener`
creates an in-app-only notification for 7 curated event types
(`ticket.assigned`, `opportunity.won`/`lost`, `quote.accepted`/`rejected`,
`payment.succeeded`/`failed`) with zero email involvement — email today only
happens for a disjoint set of event types via `MailListener`
(`quote.sent`, `ticket.created`, etc.).

Goal: let a user opt in to also receiving these 7 notification types by
email — either immediately or as a once-daily digest — without changing the
in-app behavior at all, and without expanding which events create a
notification (that "firehose" idea stays deferred, unaddressed here).

## Scope decisions

- **One global mode per user**, not a 7-way permission matrix:
  `emailDelivery: "off" | "immediate" | "daily_digest"`, defaulting to
  `"off"` — byte-for-byte today's behavior until a user opts in.
  Per-event-type granularity would be real added complexity (schema + UI
  matrix) for no evidenced need; recorded as a deliberate cut, matching this
  project's discipline of picking the smallest change that satisfies the
  deferral.
- **In-app notifications are never gated by this preference** — only the
  additional email channel is opt-in. No "mute in-app" is built here.
- **Not ported to `apps/notifications-service`** (Phase 18's opt-in
  microservices split). That service is off by default and, per
  [ADR 0018](../decisions/0018-microservices-split-phase18-scope.md), is a
  proof of the extraction pattern, not maintained at full feature parity
  with the in-process module. This phase builds preferences/digest only in
  `apps/api`'s `NotificationsModule`, the default path. Recorded explicitly
  as a scope cut in [ADR 0019](../decisions/0019-notification-preferences-phase19-scope.md),
  not a silent gap.
- **Digest cadence is fixed** (`@Cron("0 8 * * *")`, once daily, same
  timezone posture as `RenewalsScheduler`), not per-user configurable —
  same proportionality call.
- **Digest idempotency** via a new nullable `digestSentAt` column on
  `notifications`: the digest job selects undigested rows for
  `daily_digest`-mode users, emails one summary per user, then stamps
  `digestSentAt = now()`. A user in `immediate` mode never touches this
  column (the two modes are mutually exclusive per the single enum field),
  so there's no double-send risk between them.
- **Best-effort, non-blocking mail** — same posture as `MailListener`/
  `AuditListener`: a mail failure is logged and swallowed, never breaks
  notification creation or the digest batch for other users.

## Backend — `apps/api`

**Schema** (`apps/api/src/database/schema/notifications.schema.ts`):
- `digestSentAt: timestamp("digest_sent_at", { withTimezone: true })`
  (nullable) added to the existing `notifications` table.
- New `notificationPreferences` table in the same `notificationsSchema`:
  `id`, `organizationId` (FK → organizations, cascade), `userId` (FK →
  users, cascade), `emailDelivery: text("email_delivery").notNull().default("off")`
  (plain string column, matching the existing `text("status")` convention
  used everywhere else in this codebase), `updatedAt`. Unique index on
  `(organizationId, userId)` — the `onConflictDoUpdate` target for upsert.
- Migration generated via `pnpm --filter @sales-platform/api db:generate`,
  applied via `db:migrate` (`0012_ambiguous_blink.sql`).

**Contracts** (`packages/contracts/src/notifications.ts`):
- `NotificationEmailDeliveryMode = "off" | "immediate" | "daily_digest"`
- `NotificationPreferencesDto { emailDelivery: NotificationEmailDeliveryMode }`
- `updateNotificationPreferencesSchema` (zod) + `UpdateNotificationPreferencesInput`
  — same zod-schema-colocated-with-DTO convention as
  `packages/contracts/src/identity.ts`'s `createTeamSchema`.

**`SharedModule`** (`apps/api/src/shared/shared.module.ts`): `MailerService`
added to the `exports` array — first cross-module consumer.

**`NotificationsService`**: `getPreferences`/`setPreferences` (upsert via
`onConflictDoUpdate`); `create()` extended to send an immediate email (via
the now-exported `MailerService`, absolute link built from `WEB_APP_URL`)
when the recipient's preference is `"immediate"`, wrapped in try/catch.

**New `NotificationDigestService`**: `sendDueDigests()` — inner-joins
`notifications` to `notificationPreferences` on `(organizationId, userId)`
for `emailDelivery = "daily_digest"` and `digestSentAt IS NULL`, groups by
user, sends one email per user, stamps `digestSentAt`. Per-user try/catch —
one failure doesn't abort the batch.

**New `NotificationDigestScheduler`**: one-line `@Cron("0 8 * * *")` wrapper,
same "thin timer, tests call the service directly" shape as
`RenewalsScheduler`.

**`NotificationsController`**: `GET`/`PUT /notifications/preferences`,
`@CurrentUser()`-scoped, no new permission — same "authenticated only"
precedent the class already documents.

**`NotificationsModule`**: registers `NotificationDigestService` and
`NotificationDigestScheduler` as providers.

## Frontend — `apps/web`

- `apps/web/src/hooks/use-notification-preferences.ts` — `useNotificationPreferences()`
  (query) + `useUpdateNotificationPreferences()` (mutation), same shape as
  `use-notifications.ts`.
- `apps/web/src/app/(dashboard)/settings/notifications/page.tsx` — a plain
  `useState`-driven radio-button form (no react-hook-form/zod-resolver
  anywhere in this frontend), matching `administration/teams/page.tsx`'s
  pattern.
- Not added to `apps/web/src/lib/nav.ts` (that array mirrors the brief's
  fixed information architecture). Instead, a "Notification settings" link
  was added to `AppTopbar`'s right-hand actions group, next to the existing
  `NotificationBell`/username/Sign-out.

## Testing

- **Unit** (new — `apps/api/src/modules/notifications/` previously had only
  e2e coverage): `notifications.service.spec.ts` (preferences
  get/upsert, immediate-email-on-create gating, mail-failure swallowed);
  `notification-digest.service.spec.ts` (batches per user, stamps
  `digestSentAt`, skips non-digest users, swallows one user's failure
  without skipping the rest).
- **e2e** (`apps/api/test/notification-preferences.e2e-spec.ts`, real
  Mailpit via the existing `apps/api/test/setup/mailpit.ts` helpers):
  default-off + update + invalid-mode-400; authentication required;
  `"immediate"` produces both the in-app notification and a real email;
  `"daily_digest"` produces no immediate email, and a direct
  `NotificationDigestService.sendDueDigests()` call (same "call the service,
  don't wait on the cron" precedent as the renewals e2e spec) produces one
  digest email and is idempotent on a second call.
- Full existing `apps/api` unit (145/145) + e2e suites re-run — no
  regression to the default (`"off"`) in-app-only behavior.

## Docs

- [ADR 0019](../decisions/0019-notification-preferences-phase19-scope.md).
- This plan, persisted.
- `docs/architecture/overview.md` — new "Phase 19 scope" section; deferred-
  items table row resolved.
- `README.md` — Phase 19 marked current.

## Verification

1. Migration generated + applied against the dev DB — confirmed
   `notification_preferences` table and `notifications.digest_sent_at`
   column exist.
2. New unit specs green.
3. New e2e spec green against real Mailpit (immediate email, digest email +
   idempotency, default-off behavior, validation 400) — one real race
   surfaced and fixed during verification (see below).
4. Full existing `apps/api` unit (145/145, 26/26 suites) + e2e suites green.
5. `pnpm build` / `pnpm typecheck` clean across all workspace packages.

### Known implementation risks resolved empirically

- `ticket.assigned` (and the other 6 notification event types) are consumed
  by a fire-and-forget `EventEmitter2.emit()` call in
  `DomainEventBus.publish()` — not `emitAsync()` — so notification creation
  is eventually consistent with the HTTP request that triggered it, not
  synchronous with it; a pre-existing, previously-observed source of
  occasional flakiness in `notifications.e2e-spec.ts` under full-suite load,
  unrelated to this phase. The first version of `create()` awaited the whole
  preference-check/email chain, adding a second DB round trip to *every*
  notification created (including the default `"off"` case), which
  measurably widened that pre-existing race — reproduced deterministically
  enough in a full e2e run to require a real fix, not just a rerun. Fixed at
  the source: `NotificationsService.create()`'s email dispatch is now
  fire-and-forget (`void this.dispatchImmediateEmail(...)`, internally
  try/catch-guarded), so `create()` resolves as soon as the in-app insert
  does — exactly matching pre-Phase-19 timing regardless of preference. The
  new e2e test's own "immediate" case still deterministically observes the
  email by polling Mailpit (`waitForMessage`) before checking the in-app
  list — since `create()` inserts before it ever attempts the email, seeing
  the email confirms the row is already committed, no arbitrary sleep
  needed. A second, unrelated pre-existing flake
  (`search-opensearch.e2e-spec.ts`, OpenSearch indexing/refresh timing under
  load) was also observed and confirmed non-deterministic via isolation
  reruns — no code change, consistent with how it was already documented in
  ADR 0018's verification.
- Required rebuilding `packages/contracts`
  (`pnpm --filter @sales-platform/contracts build`) after adding the new zod
  schema — `apps/api` resolves that package via its built `dist/`, not live
  TS source, so a stale build 500'd every request through the new
  `ZodValidationPipe` until rebuilt.

### Critical files
- `apps/api/src/database/schema/notifications.schema.ts`
- `packages/contracts/src/notifications.ts`
- `apps/api/src/shared/shared.module.ts`
- `apps/api/src/modules/notifications/notifications.service.ts`
- `apps/api/src/modules/notifications/notification-digest.service.ts` (new)
- `apps/api/src/modules/notifications/notification-digest.scheduler.ts` (new)
- `apps/api/src/modules/notifications/notifications.controller.ts`
- `apps/api/src/modules/notifications/notifications.module.ts`
- `apps/web/src/hooks/use-notification-preferences.ts` (new)
- `apps/web/src/app/(dashboard)/settings/notifications/page.tsx` (new)
- `apps/web/src/components/layout/app-topbar.tsx`
- `apps/api/test/notification-preferences.e2e-spec.ts` (new)
