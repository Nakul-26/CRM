# Phase 7 — Subscriptions (Plans, Subscriptions, Renewals)

## Context

Phases 1-6 (Identity, CRM, Leads, Sales Pipeline, Quotations, Support) are
built, tested, and running. The three `ComingSoon` stubs at
`apps/web/src/app/(dashboard)/subscriptions/{,plans,renewals}/page.tsx` are
all labeled `phase="Phase 7 (Subscriptions)"`, confirming this is Phase 7.
`packages/contracts/src/permissions.ts` already reserves `subscriptions.view`,
`subscriptions.create`, `subscriptions.manage` (comment: "reserved here so
role/permission seeding and the RBAC UI don't need a breaking change to grow
into them") — a flat single-namespace shape, unlike Support's three-namespace
split (`support.tickets.*`/`support.sla_policies.*`/`support.kb.*`). This
phase honors that shape rather than fragmenting it.

ADR 0001 explicitly anticipates Renewals: "a Postgres-backed job table
covers renewal reminders etc." — the one concrete technical hint anywhere in
the repo about *how* this should work, and the reason Temporal/RabbitMQ stay
deferred. Nothing else about Subscriptions is scoped anywhere (no billing/
payment env vars, no Stripe references, no `notifications` module — that
name is reserved in ADR 0001's module list but has zero implementation).

Two prior patterns combine here for the first time: Quotes' **lazy-persisted
status transition** (`expireIfDue`, checked on every `list`/`findById`) and
a **genuinely new piece of infrastructure** — this is the first scheduled/
background process in the codebase (`@nestjs/schedule`, not previously a
dependency). Both are needed because a subscription lapsing is a *state*
question (answerable lazily, like quote expiry) while a renewal reminder
email is a *proactive side effect* that must fire even if nobody opens the
page that day (unlike SLA breach flags, which stay purely computed because
nothing needs to happen if nobody looks).

---

## 0. Scope decisions

| Decision | Reasoning |
|---|---|
| **One module, three sub-resources, folder-per-subdomain**: `apps/api/src/modules/subscriptions/{plans,subscriptions,renewals}/`, one `pgSchema("subscriptions")` holding `plans`, `subscriptions`, `renewal_reminders`. | Mirrors Support's shape (three real sub-resources). The three subfolders map 1:1 onto the three frontend routes (`/subscriptions`, `/subscriptions/plans`, `/subscriptions/renewals`) — `renewals/` holds the reminder-log access + the scheduler, not a fourth CRUD resource. |
| **No payment/billing integration this phase.** Renewal is a manual action (`POST /subscriptions/:id/renew`) that extends the period — no charge processor, no Stripe, no webhook handling. | Zero payment infra exists anywhere (no env vars, no docker-compose service, no package) — same "defer until a concrete need forces it" discipline ADR 0001 already applies to RabbitMQ/Keycloak/Temporal/OpenSearch. Recorded as an explicit scope cut in the new ADR, not a silent gap. |
| **No trial period.** Subscription status is `active \| lapsed \| cancelled` — no `trialing`. Plans have no `trialDays` field. | A `trialing` status with no trial-length field or trial-end automation behind it would be state with no real behavior — the same "don't build a half-finished piece" discipline used to keep SLA breach purely computed in Phase 6. Add trials later as one coherent feature (field + status + automation) if a concrete need arises. |
| **Subscription status: fixed 3-state graph, no generic transition map.** `active → cancelled` (explicit), `active → lapsed` (lazy, read-time, mirrors quotes' `expireIfDue`), `lapsed → active` (explicit `renew`, extends the period), `lapsed → cancelled` (explicit), `cancelled → []` (terminal, like quotes' `accepted`). | Two explicit actions (`cancel`, `renew`), each with one precondition check — closer to Quotes' inline-checked `send`/`accept`/`reject` methods (`if (status !== "sent") throw ConflictException`) than to Leads/Tickets' generic `ALLOWED_TRANSITIONS` map, which exists to handle branchier graphs than this one has. |
| **Plan fields snapshot onto the subscription at creation; `renew` never re-reads the live Plan.** `subscriptions.planName`/`price`/`billingInterval` are copied from the Plan once, at creation. `renew()` extends `currentPeriodEnd` using the *snapshotted* `billingInterval`, not the Plan's current one. | Same "snapshot, not live reference" reasoning as quote line items (ADR 0005) and ticket SLA due-dates (ADR 0006) — editing a Plan's price later never silently changes an existing subscription's rate. |
| **No plan upgrade/downgrade path.** A subscription is created against one Plan and stays on that snapshot for its life; changing plans isn't built this phase. | A real "change plan" flow needs proration/pricing rules that don't exist without payment processing — a separable increment, recorded as a scope cut. |
| **Renewal reminders: a Postgres job table (`renewal_reminders`) + `@nestjs/schedule` `@Cron`, not Redis/BullMQ.** One row per (subscription, period) with `remindAt`/`sentAt`; a `@Cron("*/15 * * * *")` task calls an extracted `RenewalsService.processDueReminders()` (directly callable/testable without waiting on the clock) that queries `remindAt <= now() AND sentAt IS NULL`. Lead time is a hardcoded `RENEWAL_REMINDER_LEAD_DAYS = 7` constant, not per-org configurable this phase. | Confirms ADR 0001's own deferred-tech row instead of contradicting it — Redis is provisioned but unused anywhere in this codebase, and there's no cron/scheduler precedent yet to build on. This is the first scheduled process in the codebase; `@nestjs/schedule` is a new dependency, flagged explicitly (same as nodemailer was flagged as new in Phase 6). |
| **Reminder emails route through the existing `MailListener`, not a direct `MailerService` call from the scheduler.** The scheduler enriches its own event payload (looks up account/contact, same as `TicketsService`/`QuotesService` already do) and publishes `subscription.renewal_reminder_sent`; a fourth `MailListener` handler sends the mail. The scheduler marks the reminder row's `sentAt` immediately after publishing (fire-and-forget), not after confirming delivery. | Keeps ADR 0006 decision #7's "zero service dependencies beyond `MailerService`" shape intact — no scheduler-specific exception to the mail architecture. Treating "dispatched" as "sent" is the same best-effort posture `AuditListener`/`MailListener` already use everywhere (log and move on, never block the operation that triggered it) — here "the operation" is the scheduler tick itself. |
| **`DomainEventBus.publish()` works from a scheduler tick with no request context** — it already accepts an explicit `organizationId` (falls back to request context only if omitted; `actorId` is optional and simply `null` in the audit log for system-originated events). | Confirmed by reading `shared/events/domain-event-bus.ts` — no changes needed to shared infra, just pass `organizationId` explicitly from the scheduler, same contract every other publisher already satisfies. |
| **Permissions extend the already-reserved flat `subscriptions.*` namespace — no new namespaces.** Add `.edit`/`.delete` (Subscriptions gets the same `view/create/edit/delete` shape as every other domain). `subscriptions.manage` — already reserved, previously undefined — narrows to **Plan mutations only** (create/edit/delete a Plan), gating `/plans` POST/PATCH/DELETE. `subscriptions.view` covers viewing Plans, Subscriptions, and Renewals alike (one namespace, not three). | Direct continuation of ADR 0006 decision #5's move (`support.tickets.manage` narrowed to reassignment once `.edit` existed) — same "an already-reserved coarse permission narrows to something specific once granular ones exist" pattern, applied to a permission set that was reserved with this single-namespace shape from the start. |
| **Member role gets `subscriptions.edit`** (can create/cancel/renew subscriptions), alongside the `view`/`create` it already has. `.delete` and `.manage` (Plans) stay Owner/Admin-only. | Matches every prior phase's Member split (can do day-to-day lifecycle work, can't delete records or manage the small admin-configured resource — same shape as `support.tickets.edit` vs `.manage`/`.delete`). |
| **Events: `SUBSCRIPTIONS_EVENT_TYPES`, fifth use of the `TIMELINE_EVENT_TYPES` extension point.** `plan.created/updated/deleted`, `subscription.created/cancelled/renewed/lapsed/renewal_reminder_sent`. Timeline-worthy subset (carries `accountId`): `subscription.created`, `subscription.cancelled`, `subscription.renewed`, `subscription.lapsed`. `renewal_reminder_sent` is deliberately **not** added to the timeline. | `timeline.service.ts`'s own doc comment names `subscriptions` as the anticipated next user of the extension point after `ticket.*`. Leaving `renewal_reminder_sent` off mirrors Phase 6's precedent of being selective (`ticket.assigned` wasn't added either) — a reminder firing is an operational detail, not a customer-facing milestone. |
| **Renewal history isn't surfaced as its own endpoint this phase.** `SubscriptionDto` gets one computed field, `currentPeriodReminderSent: boolean`, populated by checking whether a `renewal_reminders` row for the current period has `sentAt` set — enough for the Renewals page to show reminder status without a dedicated `GET /subscriptions/:id/renewal-reminders` endpoint. | Keeps frontend scope to the three planned pages; a full reminder audit log is a cheap, separable follow-up if ever needed — recorded as a deferral, not silently dropped. |

---

## 1. Data model

New `apps/api/src/database/schema/subscriptions.schema.ts`, `pgSchema("subscriptions")`
— imports `accounts`/`contacts` from `crm.schema.ts`:

```ts
export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export const SUBSCRIPTION_STATUSES = ["active", "lapsed", "cancelled"] as const;

export const plans = subscriptionsSchema.table("plans", {
  id, organizationId,
  name: text().notNull(),
  description: text(),
  price: numeric({ precision: 12, scale: 2 }).notNull(),   // matches products.schema.ts convention
  billingInterval: text().notNull().default("monthly"),     // BILLING_INTERVALS
  isActive: boolean().notNull().default(true),
  createdAt, updatedAt, createdBy, updatedBy, deletedAt,
}, (t) => ({
  orgIdx: index().on(t.organizationId),
  orgNameUnique: uniqueIndex().on(t.organizationId, t.name).where(isNull(t.deletedAt)),
}));

export const subscriptions = subscriptionsSchema.table("subscriptions", {
  id, organizationId,
  accountId: uuid().notNull().references(() => accounts.id, { onDelete: "cascade" }),
  contactId: uuid().references(() => contacts.id, { onDelete: "set null" }),
  planId: uuid().references(() => plans.id, { onDelete: "set null" }),
  planName: text().notNull(),          // snapshot at creation
  price: numeric({ precision: 12, scale: 2 }).notNull(),  // snapshot
  billingInterval: text().notNull(),    // snapshot
  status: text().notNull().default("active"),  // SUBSCRIPTION_STATUSES
  currentPeriodStart: timestamp({ withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp({ withTimezone: true }).notNull(),
  cancelledAt: timestamp({ withTimezone: true }),
  createdAt, updatedAt, createdBy, updatedBy, deletedAt,
}, (t) => ({
  orgIdx: index().on(t.organizationId),
  orgStatusIdx: index().on(t.organizationId, t.status),
  accountIdx: index().on(t.accountId),
  periodEndIdx: index().on(t.currentPeriodEnd),
}));

export const renewalReminders = subscriptionsSchema.table("renewal_reminders", {
  id, organizationId,
  subscriptionId: uuid().notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
  remindAt: timestamp({ withTimezone: true }).notNull(),
  sentAt: timestamp({ withTimezone: true }),
  createdAt,
}, (t) => ({
  subIdx: index().on(t.subscriptionId),
  pendingIdx: index().on(t.remindAt, t.sentAt),   // scheduler's polling query
}));
```

`relations(...)` per table (subscription ↔ account/contact/plan/reminders,
each table ↔ organization). Barrel-export from
`apps/api/src/database/schema/index.ts`.
`pnpm --filter @sales-platform/api db:generate` + `db:migrate` — **inspect
the generated SQL for the same drizzle-kit unqualified-`DROP INDEX` bug
found in Phase 6** (the partial `orgNameUnique` index is the same shape
that triggered it) and hand-fix if it recurs.

---

## 2. Contracts

`packages/contracts/src/subscriptions.ts` (new): `BILLING_INTERVALS`/
`BillingInterval`, `SUBSCRIPTION_STATUSES`/`SubscriptionStatus`, `PlanDto`
(`price: number`, matching `ProductDto`'s `unitPrice: number` convention),
`SubscriptionDto` (includes computed `currentPeriodReminderSent: boolean`);
`createPlanSchema` (`name`, `price: z.number().nonnegative()`,
`billingInterval?` default `"monthly"`, `description?`, `isActive?` default
`true`), `updatePlanSchema` (partial); `createSubscriptionSchema`
(`accountId`, `planId`, `contactId?`, `currentPeriodStart?` default now —
service computes `currentPeriodEnd` from the plan's `billingInterval`).
No body schemas needed for `cancel`/`renew` (plain action routes, same
shape as `POST /quotes/:id/send`). `packages/contracts/src/index.ts` — add
export.

---

## 3. Permissions & events

`permissions.ts` — extend the existing reserved block to
`subscriptions.view/create/edit/delete/manage` (add `.edit`/`.delete`;
`.manage` narrows to Plan mutations per §0). Member bundle gains
`subscriptions.edit` alongside its existing `.view`/`.create`; `.delete`
and `.manage` stay Owner/Admin-only.

`events.ts` — new `SUBSCRIPTIONS_EVENT_TYPES`: `plan.created/updated/
deleted`, `subscription.created/cancelled/renewed/lapsed/
renewal_reminder_sent` — appended after `SUPPORT_EVENT_TYPES`.
`TIMELINE_EVENT_TYPES` gains `subscription.created`, `subscription.
cancelled`, `subscription.renewed`, `subscription.lapsed` (payloads carry
`accountId`) — fifth real use of the extension point.
`TimelineService.summarizeEvent()` gets matching cases.

---

## 4. Backend modules

`apps/api/src/modules/subscriptions/`:
- `plans/plans.service.ts` + `.controller.ts` — CRUD; org+name uniqueness
  via the partial unique index, caught and translated to 409 (same
  pre-check-then-throw shape as `SlaPoliciesService`).
- `subscriptions/subscriptions.service.ts` — `list`/`findById` (both call
  a private `lapseIfDue(row)` first, mirroring `QuotesService.expireIfDue`
  exactly: `if (status === "active" && currentPeriodEnd < now()) persist
  status="lapsed" + publish "subscription.lapsed"`, else return unchanged);
  `create` (validates account/contact via direct reads — same narrow
  cross-schema precedent `TicketsService`/`QuotesService` use; looks up the
  Plan, snapshots `planName`/`price`/`billingInterval`, computes
  `currentPeriodEnd` from `currentPeriodStart` + interval, publishes
  `subscription.created`, inserts the first `renewal_reminders` row);
  `cancel` (guard: not already `cancelled`; stamps `cancelledAt`, publishes
  `subscription.cancelled`, deletes pending unsent reminder rows for this
  subscription); `renew` (guard: `active` or `lapsed`; extends
  `currentPeriodEnd` by the snapshotted `billingInterval`, status → `active`,
  publishes `subscription.renewed`, inserts the next `renewal_reminders`
  row); `delete` (soft).
- `subscriptions/subscription-lapse.ts` — pure `isLapseDue(subscription, now)`
  + `.spec.ts` unit test (same shape as `ticket-sla.ts`).
- `renewals/renewals.service.ts` — `RenewalsService.processDueReminders()`
  (queries `renewal_reminders` where `remindAt <= now() AND sentAt IS
  NULL`, joins the subscription + account/contact for email fields, calls
  `DomainEventBus.publish("subscription.renewal_reminder_sent", {
  organizationId: reminder.organizationId, payload: {...} })` explicitly
  passing `organizationId` since there's no request context, marks
  `sentAt`); `RenewalsScheduler` — `@Cron("*/15 * * * *")` provider that
  just calls `processDueReminders()`, kept minimal so tests call the
  service method directly without waiting on the clock.
- `subscriptions.module.ts` — registers all three controllers/services;
  `SubscriptionsService` constructor-injects `PlansService` (same-module
  DI, mirrors `TicketsService` injecting `SlaPoliciesService`);
  `RenewalsService` constructor-injects nothing beyond `Database`/
  `DomainEventBus` (no cross-service DI needed — it reads
  `subscriptions`/`renewal_reminders`/`accounts`/`contacts` directly, same
  precedent `QuotesModule` already set for direct cross-schema reads).

`app.module.ts` — import `SubscriptionsModule` after `SupportModule`; add
`ScheduleModule.forRoot()` to the root `imports` array alongside the
existing `EventEmitterModule.forRoot()` (first use of `@nestjs/schedule`
in the codebase).

**Route table:**

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/plans` | `subscriptions.view` / `.manage` |
| GET/PATCH/DELETE | `/plans/:id` | `.view` / `.manage` / `.manage` |
| GET/POST | `/subscriptions` | `subscriptions.view` / `.create` |
| GET/PATCH/DELETE | `/subscriptions/:id` | `.view` / `.edit` / `.delete` |
| POST | `/subscriptions/:id/cancel` | `subscriptions.edit` |
| POST | `/subscriptions/:id/renew` | `subscriptions.edit` |

---

## 5. Cross-module & infra wiring

- No new cross-module imports — `SubscriptionsModule` reads
  `crm.accounts`/`crm.contacts` directly, same precedent `QuotesModule`/
  `SupportModule` already set.
- `apps/api/package.json` — add `@nestjs/schedule` (dependency).
- `apps/api/src/shared/mail/mail.listener.ts` — add a fourth handler,
  `onSubscriptionRenewalReminderSent` (`@OnEvent("subscription.
  renewal_reminder_sent")`), same try/catch-and-log shape as the other
  three; local `SubscriptionRenewalReminderPayload` interface.
- `apps/api/src/app.module.ts` — `ScheduleModule.forRoot()` +
  `SubscriptionsModule` import, as above.
- Timeline: `TIMELINE_EVENT_TYPES` + `summarizeEvent()` changes from §3 —
  zero changes to the merge query itself.

---

## 6. e2e testing strategy — no waiting on real time

`RenewalsService.processDueReminders()` is called **directly** in e2e
tests (not via the `@Cron` schedule) after inserting/backdating a
`renewal_reminders` row's `remindAt` via a raw `db.update(...)` — the same
"reach into the DB directly to set up an otherwise time-dependent state"
technique already used in Phase 6's ticket-breach tests
(`app.get<Database>(DATABASE_CONNECTION)`). Mail assertions reuse the
existing `apps/api/test/setup/mailpit.ts` helper — no new mail test infra
needed.

New `apps/api/test/plans.e2e-spec.ts`: CRUD, org+name uniqueness → 409,
cross-tenant 404s, RBAC (`.manage` is Owner/Admin only).

New `apps/api/test/subscriptions.e2e-spec.ts`: create snapshots Plan
fields + computes `currentPeriodEnd` correctly per billing interval;
`cancel` guard rejects an already-cancelled subscription; `renew` extends
the period and flips `lapsed → active`; lazy lapse — backdate
`currentPeriodEnd`, confirm `list`/`findById` persists `status: "lapsed"`
and publishes the event; cross-tenant 404s; RBAC (Member can create/
cancel/renew, cannot delete or manage plans).

New `apps/api/test/renewals.e2e-spec.ts`: backdate a `renewal_reminders`
row's `remindAt`, call `processDueReminders()` directly, assert `sentAt`
gets stamped and a real email lands in Mailpit (with-contact and
no-contact/no-email-attempted cases, mirroring `mail.e2e-spec.ts`'s
existing pattern); confirm `cancel` deletes any pending unsent reminder
for that subscription (no email fires after cancellation even if
`processDueReminders()` runs).

Extend `crm-timeline.e2e-spec.ts`: `subscription.created`/`cancelled`/
`renewed`/`lapsed` show on the account timeline (fifth proof of the
extension point).

---

## 7. Frontend

`apps/web/src/hooks/use-plans.ts`, `use-subscriptions.ts` — mirror
`use-sla-policies.ts`/`use-tickets.ts`: list/get/create/update/delete +
`useCancelSubscription`, `useRenewSubscription`.

`apps/web/src/components/subscriptions/plan-form.tsx`,
`subscription-form.tsx` (account/contact select — same pattern as
`ticket-form.tsx` — plus plan select, period-start date input).

Pages (replacing the three `ComingSoon` stubs):
- `subscriptions/page.tsx` — list (status filter) + create dialog +
  cancel/renew action buttons per row.
- `subscriptions/plans/page.tsx` — list + create/edit dialog, gated
  `subscriptions.manage` for mutation.
- `subscriptions/renewals/page.tsx` — subscriptions sorted by
  `currentPeriodEnd` ascending, showing days-until-renewal and the
  `currentPeriodReminderSent` flag; renew action inline.

`nav.ts` — add `permission: "subscriptions.view"` to all three existing
Subscriptions nav items, fixing the pre-existing gap (they're currently
the only section with no permission gate at all, unlike every other
section including the three Support items fixed in Phase 6).

---

## 8. Sequencing checkpoints (system stays runnable + tested after each)

**A — Schema + contracts + permissions + events foundation.**
`subscriptions.schema.ts` (new, 3 tables) + barrel; `db:generate` +
`db:migrate` (check for the drizzle-kit partial-index bug); `packages/
contracts/src/subscriptions.ts` (new) + barrel; `permissions.ts`;
`events.ts` (`SUBSCRIPTIONS_EVENT_TYPES` + `TIMELINE_EVENT_TYPES`
additions).
*Verify: typecheck both packages; full e2e suite still green, nothing
touched yet.*

**B — Plans module, tested.**
Service/controller/module skeleton (registers just Plans for now);
`apps/api/test/plans.e2e-spec.ts` (CRUD, uniqueness 409, cross-tenant
404s, RBAC).

**C — Subscriptions core: create + snapshot + cancel + renew + lazy lapse, tested.**
`subscriptions.service.ts`, `subscription-lapse.ts` + `.spec.ts`,
controller, module wiring `PlansService` in; `apps/api/test/
subscriptions.e2e-spec.ts` (full scenario set from §6).

**D — Renewals: job table + scheduler + mail trigger, tested against real Mailpit.**
`@nestjs/schedule` dependency; `ScheduleModule.forRoot()` in
`app.module.ts`; `renewals.service.ts` + `RenewalsScheduler`; fourth
`MailListener` handler; `apps/api/test/renewals.e2e-spec.ts` (full
scenario set from §6, incl. cancel-deletes-pending-reminder).

**E — Timeline integration, tested.**
`summarizeEvent()` cases; extend `crm-timeline.e2e-spec.ts` (fifth proof).

**F — Frontend.**
Hooks, forms, all 3 dashboard pages; `nav.ts` permission gates.
*Verify manually via dev server*: create a plan, create a subscription
against an account with a contact that has an email, confirm the
`subscription.created` timeline entry; cancel and renew a subscription
through the full lifecycle; backdate a reminder row directly in the DB,
manually invoke the scheduler path (or wait one `@Cron` tick) and confirm
a real reminder email lands in Mailpit; confirm a cancelled subscription's
pending reminder doesn't fire; confirm Member RBAC boundaries (can create/
cancel/renew, can't delete or manage plans).

**G — Docs + full verification.**
`docs/decisions/0007-subscriptions-phase7-scope.md` (new ADR, codifying
every §0 row — no-payment-integration cut, no-trial cut, no-plan-change
cut, the job-table-vs-Redis decision, the permission-narrowing move,
renewal-history-not-surfaced deferral); `docs/plans/0007-phase7-
subscriptions-plan.md` (this plan, persisted); `docs/architecture/
overview.md` update (module list — `subscriptions` moves from the
parenthetical "later phase" stub to a real entry; data ownership; events;
new "Phase 7 scope" section; deferred-tech table's Temporal row gets a
concrete "confirmed by Phase 7" note); `README.md` — Phase 7 marked
current, feature summary. Full unit + e2e suite, both builds, manual smoke
test as in F — final gate.

---

## Verification

- After A: typecheck + contracts build clean; e2e suite unchanged and
  green.
- After B-E: e2e green after each new spec file is added.
- After F: manual verification via `pnpm dev`, checking the scheduler
  actually fires and a real email lands in the Mailpit web UI — the one
  path with no way to assert correctness purely from HTTP response codes
  (same caveat Phase 6's mail dispatch had).
- `pnpm --filter @sales-platform/api build` and
  `pnpm --filter @sales-platform/web build` clean, final gate.

### Critical files
- `apps/api/src/database/schema/subscriptions.schema.ts` (new) — foundation for all 3 tables
- `packages/contracts/src/subscriptions.ts` (new) — shared DTOs/schemas
- `apps/api/src/modules/subscriptions/subscriptions/subscriptions.service.ts` (new) — snapshot, lazy-lapse, cancel/renew
- `apps/api/src/modules/subscriptions/subscriptions/subscription-lapse.ts` (new) — pure lapse-check function
- `apps/api/src/modules/subscriptions/renewals/renewals.service.ts` (new) — job-table polling + reminder dispatch, first scheduled process in the codebase
- `apps/api/src/shared/mail/mail.listener.ts` (existing) — gains a fourth handler
- `apps/api/src/app.module.ts` (existing) — `ScheduleModule.forRoot()` + `SubscriptionsModule` wiring
- `packages/contracts/src/events.ts` (existing) — `SUBSCRIPTIONS_EVENT_TYPES` + `TIMELINE_EVENT_TYPES` additions
- `apps/api/test/renewals.e2e-spec.ts` (new) — real-infra reminder dispatch coverage
- `apps/web/src/lib/nav.ts` (existing) — fixes the pre-existing missing-`permission` gap on the three Subscriptions items
