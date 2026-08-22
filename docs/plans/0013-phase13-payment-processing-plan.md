# Phase 13 — Payment Processing (subscription renewal checkout)

## Context

The README's Phase 7 paragraph and [ADR 0007](../../../../../d/nakul/CRM/docs/decisions/0007-subscriptions-phase7-scope.md) decision #2 explicitly deferred payment processing: "no charge processor, no Stripe, no webhook handling... renewal is a manual action." The user picked "payment processing" as the next item from the original deferred list (after CSV export, real-time streaming), then chose — via `AskUserQuestion` — a **pluggable payment provider, mock by default**: a real Stripe-shaped adapter (Checkout Session + webhook signature verification via the official `stripe` npm package) plus a deterministic, in-memory-style mock provider used by default in dev/test (`PAYMENT_PROVIDER=mock|stripe`). This is fully testable end-to-end right now with no external account, and swaps to real Stripe the moment real test keys are supplied — the same "Mailpit instead of a real SMTP provider" discipline ADR 0006 already established for email.

Zero payment infrastructure exists anywhere in the codebase today (confirmed: no `stripe` dependency, no payment env vars, no payments schema/module) — this is a clean-slate addition, not a retrofit.

**Scope: subscription renewal only**, the one place a concrete deferral was recorded. Quote acceptance already has no payment-collection deferral on record; extending payments there is new, unevidenced scope and stays out of this phase (noted as a future deferral, not a gap).

## 0. Scope decisions

| Decision | Reasoning |
|---|---|
| **New `payments` module**, its own `pgSchema("payments")` with one `payments` table (id, organizationId, subscriptionId, amount, currency, status, provider, providerRef, failureReason, createdBy, createdAt, completedAt). `subscriptionId` is `NOT NULL` — this phase's only purpose is subscription renewal. | Mirrors every other module's one-schema-per-domain shape. A generic `subjectType`/`subjectId` polymorphic design would be building for a hypothetical future (quotes) that isn't in scope — narrow now, easy to widen later since nothing else references this table yet. |
| **Existing `POST /subscriptions/:id/renew` (free, instant) is untouched.** A new route, `POST /payments/checkout` (body `{ subscriptionId }`), starts a **paid** renewal: creates a `pending` payment row, asks the active provider for a checkout session, returns `{ paymentId, checkoutUrl }`. The period is only extended once the payment succeeds — via `SubscriptionsService.renew()`, called internally by `PaymentsService` after a successful charge, so renewal side effects (period math, reminder scheduling, `subscription.renewed` event) stay the single existing source of truth regardless of whether renewal was free or paid. | Doesn't disturb Phase 7's existing behavior or its e2e tests. The old free renew stays as a documented manual override (comped renewals, admin correction); the new paid path is additive. Reusing `SubscriptionsService.renew()` rather than duplicating its period-chaining logic avoids a second, parallel place that computes `currentPeriodEnd`. |
| **A `PaymentProvider` interface** (`apps/api/src/modules/payments/providers/payment-provider.interface.ts`) with one real method that matters, `createCheckoutSession({ paymentId, amount, currency, description }) -> { checkoutUrl, providerRef }`. Two implementations: `MockPaymentProvider` (no network — `checkoutUrl` points at a new in-app page, `apps/web/src/app/pay/mock/[paymentId]/page.tsx`) and `StripePaymentProvider` (real `stripe.checkout.sessions.create(...)`, test-mode-ready). Selected via `PAYMENT_PROVIDER=mock\|stripe` (default `mock`), a factory provider in `payments.module.ts`. | Same shape as Phase 12's SSE-vs-heartbeat provider-agnostic design and Phase 6's `MailerService` abstraction — one interface, swappable implementation, selected by env var. `stripe` becomes a new dependency (flagged here explicitly, same as `@nestjs/schedule`/`nodemailer` were in ADR 0007/0006), but nothing calls into it unless `PAYMENT_PROVIDER=stripe` is set. |
| **Mock completion is a public, payment-id-scoped pair of endpoints** — `GET /payments/mock/:paymentId` (view), `POST /payments/mock/:paymentId/complete`, `POST /payments/mock/:paymentId/fail`, all `@Public()`, all reject with 400 if the payment's `provider !== "mock"` or its status isn't `pending`. | A real Stripe Checkout page is unauthenticated (stripe.com, not our app), so the mock stand-in must behave the same way for provider parity — same reasoning `PublicQuotesController`'s `shareToken`-scoped routes already establish for "an external, unauthenticated party interacts with one specific record." The payment's own UUID `id` is the unguessable capability, same trust model as a quote's `shareToken`. |
| **`POST /payments/webhook`** (`@Public()`) — Stripe-only. Verifies `Stripe-Signature` against the **raw** request body (`stripe.webhooks.constructEvent`) using `STRIPE_WEBHOOK_SECRET`. Requires `NestFactory.create(AppModule, { rawBody: true })` in `main.ts` so `req.rawBody` is available — NestJS's built-in mechanism for this, no custom body-parser middleware needed. On `checkout.session.completed`, reads `metadata.paymentId`, calls the same internal `PaymentsService.handleSucceeded()` the mock path calls. | Standard, minimal-footprint NestJS + Stripe recipe. Keeps the parsed-JSON body available for every other route unchanged (`rawBody: true` doesn't disable normal body parsing, just additionally captures the raw bytes). |
| **Idempotent completion.** `handleSucceeded`/`handleFailed` no-op (return early) if the payment isn't still `pending` — covers Stripe's documented at-least-once webhook delivery and a user double-clicking the mock "Pay" button. `SubscriptionsService.renew()` is only ever called once per payment as a result. | A real webhook-consumer correctness requirement, cheap to build in and cheap to test (the mock provider makes double-delivery trivial to simulate in an e2e test, unlike with real Stripe). |
| **On success**, `PaymentsService` calls `SubscriptionsService.renew(organizationId, payment.createdBy, subscriptionId)` (reusing the existing method verbatim) and publishes `payment.succeeded` with `{ paymentId, subscriptionId, accountId, amount, recipientId: subscription.createdBy }`. **On failure**, publishes `payment.failed` with the same recipient — the subscription is simply left as-is; if its period end passes with no successful renewal, `SubscriptionsService`'s existing lazy `lapseIfDue()` naturally lapses it. No new subscription status is introduced. | Reuses ADR 0007's existing lazy-lapse mechanism instead of inventing a "payment failed, needs retry" state — a failed renewal charge just means the subscription didn't renew, which the system already knows how to represent. Matches the session's "don't build a second shaping/state path" discipline. |
| **Notifications**: `payment.succeeded` and `payment.failed` are added to `NotificationsListener` (a 6th and 7th bounded event, each with a clear single recipient — `recipientId` from the payload, the staff member who started the checkout), matching `quote.accepted`/`quote.rejected`'s existing "outcome of an action" pattern. | Subscriptions have no `ownerId` field (unlike Opportunities/Quotes/Tickets) — `createdBy`, captured as `recipientId` when `PaymentsService` publishes the event, is the natural analog. A failed renewal charge is exactly the kind of actionable outcome this bounded set already exists for. |
| **Timeline**: `payment.succeeded` is added to `TIMELINE_EVENT_TYPES` (real money changed hands — a customer-facing milestone). `payment.checkout_started`/`payment.failed` are deliberately left off, same selectivity that already excludes `ticket.assigned`/`subscription.renewal_reminder_sent` (operational, not milestones). | Direct precedent continuation — sixth real use of the extension point documented in ADR 0007 decision 12. |
| **No new permission.** `subscriptions.edit` gates starting a checkout (same permission that already gates `/renew` and `/cancel`); `subscriptions.view` gates reading payment history. | Matches the established "reuse the resource's existing permission for a natural extension of its lifecycle" pattern (ADR 0007 decision 10, ADR 0012 decision 9). |
| **Fixed `"usd"` currency.** Subscriptions (unlike Quotes) has no `currency` column to snapshot from. Adding one is out of scope — a documented cut, not a silent gap. | Avoids retrofitting the Phase 7 `subscriptions` schema for a feature that doesn't otherwise need multi-currency. |
| **Not built:** quote-acceptance payment collection, initial-subscription-creation payment collection (creating a subscription stays free/immediate, as today), refunds, retries/dunning, a dedicated payment-history frontend page (the list endpoint exists; no UI beyond a status badge this phase), multi-currency. | Scoped to exactly ADR 0007 decision #2's deferral. Each is a reasonable, separable future increment, recorded here rather than silently gapped. |

---

## 1. Backend

### Schema — `apps/api/src/database/schema/payments.schema.ts` (new)
```ts
export const paymentsSchema = pgSchema("payments");
export const PAYMENT_STATUSES = ["pending", "succeeded", "failed"] as const;
export const PAYMENT_PROVIDERS = ["mock", "stripe"] as const;

export const payments = paymentsSchema.table("payments", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("usd"),
  status: text("status").notNull().default("pending"),      // PAYMENT_STATUSES
  provider: text("provider").notNull(),                      // PAYMENT_PROVIDERS
  providerRef: text("provider_ref"),
  failureReason: text("failure_reason"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => ({
  orgIdx: index("payments_org_idx").on(table.organizationId),
  subscriptionIdx: index("payments_subscription_idx").on(table.subscriptionId),
}));
```
Add relations (`payments.organization`, `payments.subscription`) mirroring `subscriptions.schema.ts`'s style. Export from `apps/api/src/database/schema/index.ts`. Generate + apply migration (`pnpm --filter @sales-platform/api db:generate` then `db:migrate`) as an implementation step, not by hand-writing SQL.

### Contracts — `packages/contracts/src/payments.ts` (new)
`PAYMENT_STATUSES`/`PAYMENT_PROVIDERS` (re-exported consts), `PaymentDto` (id, subscriptionId, amount, currency, status, provider, failureReason, createdAt, completedAt), `CheckoutSessionDto` ({ paymentId, checkoutUrl }), `startCheckoutSchema = z.object({ subscriptionId: z.string().uuid() })`. Export from `packages/contracts/src/index.ts`.

`packages/contracts/src/events.ts`: add
```ts
export const PAYMENTS_EVENT_TYPES = ["payment.checkout_started", "payment.succeeded", "payment.failed"] as const;
```
and add `"payment.succeeded"` to `TIMELINE_EVENT_TYPES`.

### Env — `packages/config/src/env.ts`
```ts
PAYMENT_PROVIDER: z.enum(["mock", "stripe"]).default("mock"),
STRIPE_SECRET_KEY: z.string().optional(),
STRIPE_WEBHOOK_SECRET: z.string().optional(),
```
`apps/api/.env.example`: add the three vars (commented guidance that `STRIPE_*` are only needed when `PAYMENT_PROVIDER=stripe`).

### `apps/api/src/main.ts`
Add `rawBody: true` to `NestFactory.create(AppModule, { bufferLogs: true, rawBody: true })`.

### Providers — `apps/api/src/modules/payments/providers/`
- `payment-provider.interface.ts` — the `PaymentProvider` interface + `PAYMENT_PROVIDER` DI token.
- `mock-payment.provider.ts` — `createCheckoutSession()` returns `{ checkoutUrl: \`${webAppUrl}/pay/mock/${paymentId}\`, providerRef: randomUUID() }`. No network, no Stripe dependency.
- `stripe-payment.provider.ts` — constructs a `Stripe` client from `STRIPE_SECRET_KEY` (throws a clear startup error if `PAYMENT_PROVIDER=stripe` but the key is missing — fail fast, not a silent no-op). `createCheckoutSession()` calls `stripe.checkout.sessions.create({ mode: "payment", line_items: [...], success_url, cancel_url, metadata: { paymentId } })`. Also exposes `verifyWebhookSignature(rawBody, signature): Stripe.Event` used by the controller's webhook route (only relevant when this provider is active).

### `apps/api/src/modules/payments/payments.service.ts` (new)
`startCheckout(organizationId, actorId, subscriptionId)`, `handleSucceeded(paymentId, providerRef?)`, `handleFailed(paymentId, reason?)`, `getMockView(paymentId)` (public-safe subset: amount/currency/status/description, no `organizationId`), `listForSubscription(organizationId, subscriptionId)`. Injects `SubscriptionsService` (for `.renew()` and a small new public read method — see below), `DomainEventBus`, the `PAYMENT_PROVIDER` token, `DATABASE_CONNECTION`.

`apps/api/src/modules/subscriptions/subscriptions/subscriptions.service.ts`: add one small public method, `getForCharge(organizationId, subscriptionId)`, wrapping the existing private `getRawSubscription()` — needed since `PaymentsService` must read a subscription's price/status/accountId/createdBy without duplicating that query. `renew()` itself is already public and reused as-is.

### `apps/api/src/modules/payments/payments.controller.ts` (new), `@Controller("payments")`
| Method | Path | Auth |
|---|---|---|
| POST | `/payments/checkout` | `subscriptions.edit` |
| GET | `/payments/subscriptions/:subscriptionId` | `subscriptions.view` |
| GET | `/payments/mock/:paymentId` | `@Public()` |
| POST | `/payments/mock/:paymentId/complete` | `@Public()` |
| POST | `/payments/mock/:paymentId/fail` | `@Public()` |
| POST | `/payments/webhook` | `@Public()`, raw body |

All routes live on `PaymentsController` rather than being split across `SubscriptionsController` — `PaymentsModule` imports `SubscriptionsModule` (one-directional; `SubscriptionsModule` does not import `PaymentsModule`), avoiding a circular module dependency. Confirm `SubscriptionsModule` already exports `SubscriptionsService` (it must, for `PlansService`/other consumers — verify at implementation time).

`app.module.ts`: register `PaymentsModule`.

---

## 2. e2e testing (`apps/api/test/payments.e2e-spec.ts`, new)

Default test env has no `PAYMENT_PROVIDER` set → mock provider → fully testable with no external account, per the chosen approach.

1. **Happy path**: register org, account, plan, subscription → `POST /payments/checkout` → 201 `{ paymentId, checkoutUrl }` (`checkoutUrl` contains `/pay/mock/`) → `GET /payments/mock/:paymentId` (no auth header) → `pending`, correct amount → `POST /payments/mock/:paymentId/complete` (no auth) → 200 → `GET /subscriptions/:id` shows the same `currentPeriodEnd` math as the existing free-renew e2e test → `GET /payments/subscriptions/:id` shows one `succeeded` payment.
2. **Failure path**: `.../fail` → payment `failed`, subscription's `currentPeriodEnd` unchanged (no renewal happened).
3. **Idempotency**: complete the same payment twice → second call is a no-op (or a clear 409) → subscription renewed exactly once (period end reflects a single renewal, not two).
4. **Permission gate**: `POST /payments/checkout` without `subscriptions.edit` → 403.
5. **Mock-endpoint safety**: `GET /payments/mock/:paymentId` response has no `organizationId`/account data — confirms the public view is properly curated, same care `PublicQuotesController`'s view already takes.
6. **Cancelled-subscription guard**: `POST /payments/checkout` against a cancelled subscription → 400/409 (mirrors `renew()`'s own guard).

Re-run the full unit + e2e suites after, to confirm no regressions (existing `subscriptions.e2e-spec.ts`/`renewals.e2e-spec.ts` behavior must be untouched, since the free `/renew` route isn't modified).

### Unit tests
- `mock-payment.provider.spec.ts` — `createCheckoutSession()` returns the expected URL shape, no network.
- `stripe-payment.provider.spec.ts` — `jest.mock("stripe")` to verify `createCheckoutSession()` builds the right params and maps the session response, with no real network call. Separately, a **real, no-network** webhook-signature test: use the actual `stripe` package's `Stripe.webhooks.generateTestHeaderString`/`constructEvent` (pure local HMAC, no API call) to prove a genuinely valid signature is accepted and a tampered payload/signature is rejected — the one piece of the Stripe integration that can be verified for real without live credentials.
- Explicitly documented gap (in the ADR, not hidden): `StripePaymentProvider.createCheckoutSession()`'s actual network call to Stripe's API has no live/sandbox test in this environment, since no Stripe API key is available. Verified only via the mocked-client unit test and type-checking. Switching `PAYMENT_PROVIDER=stripe` with real keys is required before relying on it — the same honesty the SSE phase used for "no browser automation available here."

---

## 3. Frontend

- `apps/web/src/hooks/use-payments.ts` (new): `useStartCheckout()` (mutation, `POST payments/checkout`), `useSubscriptionPayments(subscriptionId)` (`GET payments/subscriptions/:id`), and public-page hooks `useMockPayment(paymentId)`, `useCompleteMockPayment()`, `useFailMockPayment()` — same `apiFetch` used by `use-public-quote.ts` (already routes through the cookie-less-safe BFF gateway path; public routes work through it fine since the gateway simply forwards without an `Authorization` header when there's no session).
- `apps/web/src/app/(dashboard)/subscriptions/page.tsx`: add a second action button, "Renew with payment", next to the existing "Renew"/"Cancel" pair (same `canEdit && s.status !== "cancelled"` guard). Calls `useStartCheckout`, then `window.location.href = checkoutUrl` — works uniformly whether that URL is the in-app mock page or a real external Stripe URL. Existing "Renew" button gets a small label tweak ("Renew (no charge)") so the two aren't confused.
- `apps/web/src/app/pay/mock/[paymentId]/page.tsx` (new) — a public page (outside `(dashboard)`), structurally mirroring `apps/web/src/app/public/quotes/[token]/page.tsx`: loads via `useMockPayment`, shows amount/currency/description, "Pay now" (→ `useCompleteMockPayment`, then redirect to `/subscriptions?payment=success`) and "Cancel" (→ `useFailMockPayment`, then redirect to `/subscriptions?payment=cancelled`) buttons.

No dedicated payment-history page this phase (documented deferral) — `GET /payments/subscriptions/:id` exists and is tested, ready for a future UI.

---

## 4. Sequencing checkpoints

**A — Backend core.** Schema + migration; contracts (`payments.ts`, events additions); env vars; `main.ts` `rawBody: true`; provider interface + mock provider; `PaymentsService` (checkout/succeeded/failed/list); `PaymentsController` (checkout, list, mock routes — not yet the Stripe webhook); `SubscriptionsService.getForCharge()`; `NotificationsListener` additions; `PaymentsModule` wired into `app.module.ts`.
*Verify: unit tests for the mock provider; e2e `payments.e2e-spec.ts` happy/failure/idempotency/permission/guard cases, all against the mock provider; full existing unit + e2e suites green (no regression to `/subscriptions/:id/renew`).*

**B — Stripe adapter.** `stripe` added as a dependency; `StripePaymentProvider` (checkout session creation + webhook signature verification); `POST /payments/webhook` route; provider-selection factory in `payments.module.ts`.
*Verify: `stripe-payment.provider.spec.ts` (mocked-client params test + real local webhook-signature test); full suites still green (mock stays the default, so nothing else changes behavior). No live Stripe call is exercised anywhere in this repo's automated tests — documented explicitly.*

**C — Frontend.** `use-payments.ts`; subscriptions page's new button; the mock checkout page.
*Verify: production build (`pnpm --filter @sales-platform/web build`) clean. Manual smoke test via isolated dev ports (established convention): start a checkout, land on `/pay/mock/:id`, click Pay, confirm the subscription's `Renews` date advances on the list page; repeat for Cancel/fail. `curl` can also drive the same mock endpoints directly to double-check response shapes, as in prior phases.*

**D — Docs.** New `docs/decisions/0013-payment-processing-phase13-scope.md` (codifying every §0 row, referencing ADR 0007 decision #2); `docs/plans/0013-*.md` (this plan, persisted); `docs/architecture/overview.md` (phase-link entry + a new "Phase 13 scope" section); `README.md` (Phase 13 marked current, Phase 12 loses "(current)"). Full unit + e2e suite, both builds — final gate.

---

## Verification

- After A: `payments.e2e-spec.ts` green (mock-only, no external dependency); full existing suite unaffected (free renew untouched).
- After B: Stripe adapter unit-tested where it can be without live credentials (mocked client + real local signature verification); explicitly documented that the live network call itself is unverified in this environment.
- After C: build clean; manual mock-checkout click-through verified end-to-end (this phase's flow is fully driveable without a real payment gateway, unlike Phase 12's SSE banner which needed a real browser for the push side — here the entire loop, including "the customer's browser," is simulate-able through the mock provider).
- `pnpm --filter @sales-platform/api build` and `pnpm --filter @sales-platform/web build` clean, final gate.

### Critical files
- `apps/api/src/database/schema/payments.schema.ts` (new) — payments table
- `apps/api/src/modules/payments/payments.service.ts` (new) — checkout/succeeded/failed/list, calls `SubscriptionsService.renew()`
- `apps/api/src/modules/payments/payments.controller.ts` (new) — checkout, list, mock routes, Stripe webhook
- `apps/api/src/modules/payments/providers/{payment-provider.interface,mock-payment.provider,stripe-payment.provider}.ts` (new)
- `apps/api/src/modules/subscriptions/subscriptions/subscriptions.service.ts` (existing) — new `getForCharge()` method, `renew()` reused as-is
- `apps/api/src/shared/notifications` → `apps/api/src/modules/notifications/notifications.listener.ts` (existing) — `payment.succeeded`/`payment.failed` handlers
- `apps/api/src/main.ts` (existing) — `rawBody: true`
- `apps/api/test/payments.e2e-spec.ts` (new)
- `packages/contracts/src/payments.ts` (new), `packages/contracts/src/events.ts` (existing, additions)
- `packages/config/src/env.ts` (existing) — `PAYMENT_PROVIDER`/`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`
- `apps/web/src/hooks/use-payments.ts` (new)
- `apps/web/src/app/(dashboard)/subscriptions/page.tsx` (existing) — new "Renew with payment" action
- `apps/web/src/app/pay/mock/[paymentId]/page.tsx` (new)
