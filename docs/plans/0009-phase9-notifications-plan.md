# Phase 9 — Notifications

## Context

Phases 1-8 are built, tested, and running. Unlike every prior phase, there is
**no breadcrumb anywhere in the repo naming "Phase 9"** — I checked every ADR,
every plan doc, the module list in ADR 0001, and every `ComingSoon` stub, the
same way Phase 8's scope was synthesized, and came up empty. I flagged this to
the user directly (rather than inventing scope) and asked what Phase 9 should
cover, offering the two items that do have *some* evidence:

- The `notifications` module — named in ADR 0001's original aspirational
  module list (`... Product, Notification, Audit, Workflow, Identity`) and
  explicitly deferred, un-phase-assigned, in
  [ADR 0008](../decisions/0008-analytics-automation-phase8-scope.md) decision
  #10. It also has a live, in-code breadcrumb:
  `apps/web/src/app/(dashboard)/administration/users/page.tsx:92` — inviting a
  user shows a one-time temporary password with the comment *"a real
  notification service replaces this in a later phase"*.
- The Audit Log UI (`ComingSoon title="Audit Log" phase="Phase 2+ (audit UI)"`,
  `apps/web/src/app/(dashboard)/administration/audit/page.tsx`) — a smaller,
  already-scoped leftover stub.

The user chose **the Notifications module**.

## 0. Scope decisions

| Decision | Reasoning |
|---|---|
| **New top-level `apps/api/src/modules/notifications/` module, owning a brand-new `notifications` Postgres schema.** One table, `notifications.notifications`. | First wholly new schema-owning module since Phase 7's `subscriptions` — matches ADR 0001's "one module = one schema = one owner" rule exactly. |
| **In-app notifications only: a bounded, evidenced set of 5 existing events create a notification row for one specific recipient.** `ticket.assigned` (recipient = `payload.assigneeId`, already present), `opportunity.won` / `opportunity.lost` (recipient = the opportunity's `ownerId` — **new** payload field, added at the two publish call sites in `opportunities.service.ts`), `quote.accepted` / `quote.rejected` (recipient = the quote's `ownerId` — **new** payload field, added at the two publish call sites in `quotes.service.ts`). No new event types. | Same "publishing services enrich their own event payloads with everything the listener needs (recipient id, ready-to-use fields)" precedent `MailListener`'s own docstring states, and the same precedent Phase 8 used to add `opportunityId` to `quote.accepted`'s payload. These 5 are exactly the events in the codebase today that already have a clear, single "this specific person should know" recipient (`ownerId`/`assigneeId`) — every other domain event is either not owner-scoped (e.g. `account.updated`) or self-evidently already visible to its actor. A "notify on literally every event" design was considered and rejected as unbounded scope creep, the same discipline ADR 0008 applied to keep Analytics' metrics to exactly 7 fields. |
| **Skip (no-op) when the recipient is null, or when `actorId === recipientId`.** Don't notify a user of their own action. | Consistent, simple rule. Interacts cleanly with Phase 8's automation: `autoAdvanceOnQuoteAccepted`'s `opportunity.won` publish has no `actorId` (system-triggered, per ADR 0008 decision #6) — so the skip never suppresses it, meaning the opportunity owner *always* gets notified when a customer's quote acceptance auto-closes their deal, which is exactly the case where they most need to know. |
| **`NotificationsListener` is best-effort: caught and logged, never thrown back into the request path.** Registered as a provider directly in the modules that already publish these events (`SalesModule` for the two `opportunity.*`, wired via the existing `QuoteAcceptedListener`-style pattern) — concretely, one listener class in the new `notifications` module, imported into `SalesModule` and `QuotesModule`'s consumer graph the same way `SharedModule` globally provides `MailListener`/`AuditListener`. | Same posture already established for `MailListener`/`AuditListener`/`QuoteAcceptedListener` — never break the operation that triggered the event. Since `@OnEvent` listeners aren't scoped to the publishing module in this codebase (`AuditListener`/`MailListener` are global via `SharedModule` and already listen across every domain), the simplest, most consistent placement is: `NotificationsListener` lives in the new `notifications` module and is registered **globally** via `SharedModule` (importing `NotificationsService` there), exactly like `MailListener`/`AuditListener` — not scattered per-domain-module. |
| **API is authenticated-only, no new permission — every query is scoped to `userId = current user`.** | Direct precedent: `GET /auth/me` (`auth.controller.ts`) requires JWT auth but has no `@RequirePermissions` — self-scoped-by-construction data doesn't need an org-wide permission gate. This is the *first* resource in the app that is user-scoped rather than org-scoped, so it's called out explicitly in the new ADR as a new (but directly precedented) pattern, not a gap. |
| **Endpoints: `GET /notifications` (optional `?unreadOnly=true`, newest-first, capped at 50), `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`.** No pagination params — no endpoint in the app paginates today; a flat 50-row cap keeps the list bounded without introducing a new pattern. | Matches the app's existing "flat filtered list, no pagination" convention (e.g. `GET /tickets`). `unread-count` exists specifically to feed a topbar badge without fetching the full list. |
| **`PATCH /notifications/:id/read` 404s (not 403s) if the notification doesn't belong to the caller.** | Same cross-tenant/cross-owner 404 posture used everywhere else in the codebase (e.g. quotes, tickets) — never leak existence via a 403. |
| **Frontend: a bell icon in `AppTopbar` with an unread-count badge and a dropdown of recent notifications; clicking one marks it read and navigates to its `link`.** Unread count polled via TanStack Query `refetchInterval` (no WebSocket/SSE). | `AppTopbar` (`apps/web/src/components/layout/app-topbar.tsx`) currently has a bare `{/* Global search lands here in a later phase */}` div and nothing else in its left slot — the bell goes in the right-side actions area, next to the existing user-name/sign-out controls. Polling, not push, matches ADR 0001's "avoid new infra unless a concrete need forces it" — the exact same choice already made for Phase 7's renewal-reminder job (a Postgres table + scheduled poll, not a message queue). |
| **Not built: notification delivery preferences/settings, an email digest of notifications (that's `MailListener`'s territory and already handled per-event, e.g. `ticket.created`), a global "notify on every event" firehose.** | Recorded explicitly as a deferral, the same "record every cut, don't silently build or silently skip" discipline every prior ADR in this repo has followed. |

---

## 1. Data model

New schema file `apps/api/src/database/schema/notifications.schema.ts`:

```ts
export const notificationsSchema = pgSchema("notifications");

export const notifications = notificationsSchema.table("notifications", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),          // the source DomainEvent's eventType, e.g. "ticket.assigned"
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),                    // e.g. "/support/tickets/<id>"
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index("notifications_user_idx").on(table.organizationId, table.userId, table.createdAt),
  unreadIdx: index("notifications_unread_idx").on(table.userId, table.isRead),
}));
```

No `deletedAt`/`createdBy`/`updatedBy` — these rows are system-generated only,
never user-authored or user-deleted, so the standard audit-column set doesn't
apply (same reasoning `renewal_reminders` used in Phase 7 for its job-table
rows).

Add `export * from "./notifications.schema";` to
`apps/api/src/database/schema/index.ts`.

Plain migration via `pnpm db:generate` (no generated columns/extensions this
time — just a new schema + one ordinary table, so drizzle-kit should emit it
correctly unlike Phase 8's tsvector case). Verify with `db:migrate`.

---

## 2. Contracts

`packages/contracts/src/notifications.ts` (new):
```ts
export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface UnreadCountDto {
  count: number;
}
```
Export from `packages/contracts/src/index.ts`. No new Zod input schemas —
every endpoint takes only path/query params, no request body.

---

## 3. Events

No new event types. Two payload additions at existing publish call sites:

- `apps/api/src/modules/sales/opportunities/opportunities.service.ts` —
  both `opportunity.won` and `opportunity.lost` publishes (in `moveStage`,
  and `opportunity.won` again in `autoAdvanceOnQuoteAccepted`) gain
  `ownerId: existing.ownerId` (or `opportunity.ownerId`) in their payload.
- `apps/api/src/modules/quotes/quotes.service.ts` — both `quote.accepted`
  and `quote.rejected` publishes (in `acceptByToken`/`rejectByToken`) gain
  `ownerId: quote.ownerId` in their payload.

`ticket.assigned` needs no change — `assigneeId` is already in its payload.

---

## 4. Backend module

`apps/api/src/modules/notifications/`:
- `notifications.service.ts` — `NotificationsService`:
  - `create(organizationId, userId, { type, title, body?, link? })` — insert,
    used only by the listener.
  - `list(organizationId, userId, { unreadOnly? })` — `WHERE organizationId
    AND userId [AND isRead = false] ORDER BY createdAt DESC LIMIT 50`.
  - `unreadCount(organizationId, userId)` — `COUNT(*) WHERE ... isRead =
    false`.
  - `markRead(organizationId, userId, id)` — `UPDATE ... SET isRead = true,
    readAt = now() WHERE id = :id AND userId = :userId AND organizationId =
    :organizationId`; throws `NotFoundException` if no row matched (same
    404-not-403 posture as the rest of the app).
  - `markAllRead(organizationId, userId)` — bulk update, no return value
    needed beyond success.
- `notifications.controller.ts` — `@Controller("notifications")`, all
  routes behind `JwtAuthGuard` only (no `@RequirePermissions`), scoped via
  `@CurrentUser()`:
  - `GET /notifications?unreadOnly=`
  - `GET /notifications/unread-count`
  - `PATCH /notifications/:id/read`
  - `POST /notifications/read-all`
- `notifications.listener.ts` — `NotificationsListener`, five `@OnEvent`
  handlers (`ticket.assigned`, `opportunity.won`, `opportunity.lost`,
  `quote.accepted`, `quote.rejected`), each: resolve `recipientId` from the
  payload, no-op if falsy or `=== event.actorId`, else build a short
  `title`/`link` and call `NotificationsService.create` inside a try/catch
  that logs on failure (same `MailListener`/`AuditListener` pattern —
  `Logger.error`, never rethrow).
- `notifications.module.ts` — registers service/controller/listener.
  Since `NotificationsListener` needs to react to events published by
  `SalesModule` and `QuotesModule`, and this codebase's existing precedent
  (`AuditListener`, `MailListener`) is to register cross-cutting listeners
  **globally** in `SharedModule` rather than import them into every
  publisher's module, `NotificationsListener` + `NotificationsService`
  follow that same precedent: exported from `NotificationsModule`, and
  `NotificationsModule` imported into `SharedModule` (or the listener
  registered in `SharedModule` directly, mirroring `MailListener`'s
  placement) — whichever keeps `SharedModule` the single place that wires
  every cross-cutting, all-domain listener, consistent with today's file.
- Register `NotificationsModule` in `app.module.ts`.

**Route table (new only):**

| Method | Path | Auth |
|---|---|---|
| GET | `/notifications` | authenticated (self-scoped) |
| GET | `/notifications/unread-count` | authenticated (self-scoped) |
| PATCH | `/notifications/:id/read` | authenticated (self-scoped) |
| POST | `/notifications/read-all` | authenticated (self-scoped) |

---

## 5. e2e testing strategy

New `apps/api/test/notifications.e2e-spec.ts`:
- Assign a ticket to user B (as user A) → user B's `GET /notifications`
  contains a `ticket.assigned` entry; user A's does not (self-assign case:
  assign a ticket to the actor themself → no notification).
- Move an opportunity owned by user B to a Won stage (as user A) → user B
  gets an `opportunity.won` notification; repeat with user B as the actor →
  no notification (self-action skip).
- Accept a quote (owned by user B) via the public token flow →
  user B gets a `quote.accepted` notification (`actorId` is unset on this
  path, so the skip never applies) — reuses the same public-accept flow
  `sales-automation.e2e-spec.ts` already exercises, confirming this doesn't
  double-fire or conflict with Phase 8's `opportunity.won` automation
  notification when the accepted quote is also linked to an opportunity.
- `GET /notifications/unread-count` reflects the right count; `PATCH
  /notifications/:id/read` flips it to read and decrements the count;
  `POST /notifications/read-all` zeroes it.
- Cross-tenant/cross-user isolation: a second org's / a different user's
  notifications never appear; `PATCH .../:id/read` on someone else's
  notification 404s.
- Auth required (401 with no token).

Re-run the existing `sales.e2e-spec.ts`, `quotes.e2e-spec.ts`,
`public-quotes.e2e-spec.ts`, `sales-automation.e2e-spec.ts` suites to confirm
the new `ownerId` payload field and the new listener don't change any
existing behavior.

---

## 6. Frontend

`apps/web/src/hooks/use-notifications.ts` (new) — `useNotifications(unreadOnly?)`,
`useUnreadCount()` (`refetchInterval: 30_000`, matching a reasonable poll
cadence with no existing precedent to match against since this is the app's
first poll-driven UI hook), `useMarkRead()`, `useMarkAllRead()` mutations
that invalidate both queries on success — same TanStack Query
mutate-then-invalidate pattern every other hook file already uses.

`apps/web/src/components/layout/notification-bell.tsx` (new) — bell icon
button showing the unread count as a small badge; click opens a dropdown
(reuse existing primitives — check `components/ui/dialog.tsx` or a simple
`Popover`-free absolutely-positioned panel, matching whatever the codebase's
existing dropdown-less style already is, e.g. the account typeahead in
`use-search.ts`'s consumer) listing the most recent notifications
(title, relative time, unread dot), each row marking itself read and
navigating to `link` on click; a "Mark all read" action in the panel header.

`apps/web/src/components/layout/app-topbar.tsx` — add `<NotificationBell />`
into the existing right-hand `flex items-center gap-3` group, before the
username/sign-out controls. No change to the left-hand global-search
placeholder comment (still Phase-unassigned, untouched).

---

## 7. Sequencing checkpoints (system stays runnable + tested after each)

**A — Backend: schema, contracts, module, listener, tested.**
`notifications.schema.ts` + migration; `notifications.ts` contract + barrel;
`NotificationsService`/`Controller`/`Listener`/`Module`; register in
`SharedModule` + `app.module.ts`; `ownerId` payload additions in
`opportunities.service.ts`/`quotes.service.ts`.
`apps/api/test/notifications.e2e-spec.ts`.
*Verify: new spec green; full e2e suite (including sales/quotes/automation
specs) unaffected.*

**B — Frontend.**
`use-notifications.ts`; `notification-bell.tsx`; `app-topbar.tsx` wiring.
*Verify manually via dev server*: assign a ticket to a second user, log in as
that user, confirm the bell badge appears and the dropdown shows/clears the
notification; accept a quote linked to an opportunity via the public link
and confirm the opportunity owner sees both notifications land correctly
without duplication/error.

**C — Docs + full verification.**
`docs/decisions/0009-notifications-phase9-scope.md` (new ADR, codifying
every §0 row); `docs/plans/0009-phase9-notifications-plan.md` (this plan,
persisted); `docs/architecture/overview.md` update (module list gains
`notifications`; deferred-tech table's `notifications` row updated to point
at this ADR instead of "still deferred"; events section notes the two
`ownerId` payload additions; new "Phase 9 scope" section); `README.md` —
Phase 9 marked current, feature summary. Full unit + e2e suite, both builds,
manual smoke test as in B — final gate.

---

## Verification

- After A: e2e green (new spec + full existing suite).
- After B: manual verification via `pnpm dev` — ticket assignment, quote
  acceptance (plain and opportunity-linked), and the mark-read/mark-all-read
  actions all confirmed live against real data through the bell UI.
- `pnpm --filter @sales-platform/api build` and
  `pnpm --filter @sales-platform/web build` clean, final gate.

### Critical files
- `apps/api/src/database/schema/notifications.schema.ts` (new) — the notifications table
- `apps/api/src/modules/notifications/notifications.listener.ts` (new) — the 5 recipient-resolution rules
- `apps/api/src/modules/notifications/notifications.service.ts` (new) — list/unread-count/mark-read/mark-all-read
- `apps/api/src/shared/shared.module.ts` (existing) — gains the global `NotificationsListener` registration
- `apps/api/src/modules/sales/opportunities/opportunities.service.ts` (existing) — `opportunity.won`/`lost` payloads gain `ownerId`
- `apps/api/src/modules/quotes/quotes.service.ts` (existing) — `quote.accepted`/`rejected` payloads gain `ownerId`
- `apps/web/src/components/layout/notification-bell.tsx` (new) — the bell UI
- `apps/web/src/components/layout/app-topbar.tsx` (existing) — wires the bell in
