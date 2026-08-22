# ADR 0013: Payment Processing Phase 13 scope — a pluggable checkout provider, mock by default, wired to subscription renewal only

## Status

Accepted — 2026-08-22

## Context

[ADR 0007](0007-subscriptions-phase7-scope.md) decision #2 explicitly
deferred payment processing when Subscriptions shipped: "no charge
processor, no Stripe, no webhook handling... renewal is a manual action."
The user picked "payment processing" as the next item from the original
deferred list (payment processing, real-time streaming, RabbitMQ/Keycloak/
Temporal/OpenSearch, microservices split), after real-time streaming
([ADR 0012](0012-audit-log-streaming-phase12-scope.md)). Given a choice
between wiring up a real Stripe test account now, building a self-contained
mock, or skipping a gateway entirely for internal-only payment records, the
user chose a **pluggable provider, mock by default** — a real Stripe-shaped
adapter (Checkout Session + webhook signature verification via the official
`stripe` npm package) plus a deterministic mock used by default in dev/test
(`PAYMENT_PROVIDER=mock|stripe`). Fully testable end-to-end right now with
no external account, and ready to swap to real Stripe the moment real test
keys are supplied — the same discipline [ADR 0006](0006-support-phase6-scope.md)
already established for email (Mailpit instead of a real SMTP provider).

Zero payment infrastructure existed anywhere in the codebase before this
phase — confirmed by a full-repo sweep (no `stripe` dependency, no payment
env vars, no payments schema/module).

**Scope is subscription renewal only** — the one place a concrete deferral
was recorded. Quote acceptance has no payment-collection deferral on
record; extending payments there is new, unevidenced scope, left for a
future phase rather than silently gapped.

## Decisions

**1. A new `payments` module**, its own `pgSchema("payments")` with one
table (`apps/api/src/database/schema/payments.schema.ts`): id,
organizationId, subscriptionId (`NOT NULL` — renewal is this phase's only
purpose), amount, currency, description, status, provider, providerRef,
failureReason, createdBy, createdAt, completedAt. A generic
`subjectType`/`subjectId` polymorphic design would be building for a
hypothetical future (quotes) that isn't in scope — narrow now, easy to
widen later since nothing else references this table yet.

**2. The existing free `POST /subscriptions/:id/renew` is untouched.** A
new route, `POST /payments/checkout` (body `{ subscriptionId }`), starts a
**paid** renewal: creates a `pending` payment row, asks the active provider
for a checkout session, returns `{ paymentId, checkoutUrl }`. The period is
only extended once the payment succeeds — `PaymentsService` calls the
existing `SubscriptionsService.renew()` directly (a new, small
`SubscriptionsService.getForCharge()` read method was added alongside it),
so renewal side effects (period math, reminder scheduling,
`subscription.renewed`) stay one source of truth regardless of whether
renewal was free or paid. The old free renew stays available as a
documented manual override (comped renewals, admin correction); the paid
path is additive, not a replacement — doesn't disturb Phase 7's existing
behavior or its e2e tests.

**3. A `PaymentProvider` interface**
(`apps/api/src/modules/payments/providers/payment-provider.interface.ts`)
with one method that matters, `createCheckoutSession(...)`. Two
implementations, selected via `PAYMENT_PROVIDER=mock|stripe` (default
`mock`) through a factory provider in `payments.module.ts`:
- `MockPaymentProvider` — no network. `checkoutUrl` points at
  `apps/web/src/app/pay/mock/[paymentId]/page.tsx`, an in-app page standing
  in for an external hosted checkout page.
- `StripePaymentProvider` — real `stripe.checkout.sessions.create(...)`,
  test-mode-ready. Its Stripe client is built **lazily**, not in the
  constructor, so the class can always be registered for DI (including the
  webhook route's use of `verifyWebhookSignature`) without breaking app
  startup when running with the default mock provider and no Stripe keys
  configured at all.

`stripe` becomes a new dependency (flagged here explicitly, the same way
`@nestjs/schedule`/`nodemailer` were flagged as new in ADR 0007/0006), but
nothing calls into it unless `PAYMENT_PROVIDER=stripe` is set.

**4. Mock completion is a public, payment-id-scoped trio of endpoints** —
`GET /payments/mock/:paymentId`, `POST /payments/mock/:paymentId/complete`,
`POST /payments/mock/:paymentId/fail`, all `@Public()`, all reject with 400
if the payment's `provider !== "mock"`. A real Stripe Checkout page is
unauthenticated (stripe.com, not this app), so the mock stand-in behaves
the same way for provider parity — the same reasoning
`PublicQuotesController`'s `shareToken`-scoped routes already establish for
"an external, unauthenticated party interacts with one specific record."
The payment's own UUID `id` is the unguessable capability, same trust model
as a quote's `shareToken`.

**5. `POST /payments/webhook`** (`@Public()`) — Stripe-only. Verifies
`Stripe-Signature` against the **raw** request body
(`stripe.webhooks.constructEvent`) using `STRIPE_WEBHOOK_SECRET`. Requires
`NestFactory.create(AppModule, { rawBody: true })` in `main.ts` (and the
same option passed to `moduleRef.createNestApplication()` in the shared
e2e test bootstrap, `test/setup/test-app.ts`) so `req.rawBody` is available
— NestJS's built-in mechanism for this, no custom body-parser middleware.
On `checkout.session.completed`, reads `metadata.paymentId` and calls the
same internal `PaymentsService.handleSucceeded()` the mock path calls; on
`checkout.session.expired`, calls `handleFailed()`.

**6. Idempotent completion.** `handleSucceeded`/`handleFailed` no-op
(return early) if the payment isn't still `pending` — covers Stripe's
documented at-least-once webhook delivery and a user double-clicking the
mock "Pay" button. `SubscriptionsService.renew()` is therefore only ever
called once per payment. Verified in `payments.e2e-spec.ts` by completing
the same mock payment twice and asserting the subscription's
`currentPeriodEnd` only advanced once.

**7. On success**, `PaymentsService` calls
`SubscriptionsService.renew(organizationId, payment.createdBy,
subscriptionId)` and publishes `payment.succeeded` with `{ paymentId,
subscriptionId, accountId, amount, recipientId: payment.createdBy }`. On
failure, publishes `payment.failed` with the same recipient — the
subscription is simply left as-is; if its period end passes with no
successful renewal, the existing lazy `lapseIfDue()` naturally lapses it.
**No new subscription status was introduced** — reuses ADR 0007's existing
lazy-lapse mechanism instead of inventing a "payment failed, needs retry"
state, the same "don't build a second shaping/state path" discipline ADR
0012 followed for stream payloads.

**8. Notifications**: `payment.succeeded` and `payment.failed` extend
`NotificationsListener` (a sixth and seventh bounded event, each with a
clear single recipient — `recipientId`, the staff member who started the
checkout). Subscriptions have no `ownerId` field (unlike Opportunities/
Quotes/Tickets); `createdBy`, captured as `recipientId` when
`PaymentsService` publishes the event, is the natural analog. A failed
renewal charge is exactly the actionable-outcome shape this bounded set
already exists for.

**9. Timeline**: `payment.succeeded` extends `TIMELINE_EVENT_TYPES` — real
money changed hands, a customer-facing milestone. `payment.checkout_started`/
`payment.failed` are deliberately left off, the same selectivity that
already excludes `ticket.assigned`/`subscription.renewal_reminder_sent`
(operational, not milestones). Sixth real use of the extension point
documented in ADR 0007 decision #12.

**10. No new permission.** `subscriptions.edit` gates starting a checkout
(same permission that already gates `/renew` and `/cancel`);
`subscriptions.view` gates reading payment history. Matches the established
"reuse the resource's existing permission for a natural extension of its
lifecycle" pattern (ADR 0007 decision #10, ADR 0012 decision #9).

**11. Fixed `"usd"` currency.** Subscriptions (unlike Quotes) has no
`currency` column to snapshot from. Adding one is out of scope — a
documented cut, not a silent gap.

**12. Not built:** quote-acceptance payment collection, paid initial
subscription creation (creating a subscription stays free/immediate, as
today), refunds, retries/dunning, a dedicated payment-history frontend page
(the `GET /payments/subscriptions/:id` list endpoint exists and is tested;
no UI beyond the mock checkout page itself this phase), multi-currency.
Each is a reasonable, separable future increment, recorded here rather than
silently gapped.

**13. Testing honesty**: `StripePaymentProvider.createCheckoutSession()`'s
actual network call to Stripe's API has no live/sandbox test in this
environment, since no Stripe API key is available — verified only via a
mocked-client unit test (`stripe-payment.provider.spec.ts`, swapping the
lazily-built client for a stub) and type-checking. Its webhook signature
verification, by contrast, is genuinely tested — `constructEvent`/
`generateTestHeaderString` are pure local HMAC operations, no network —
both as a unit test and end-to-end in `payments.e2e-spec.ts` (a correctly
signed payload succeeds; a bad signature is rejected with 400 and the
payment stays untouched). The same honesty Phase 12 used for "no browser
automation available here."

## Consequences

- Staff can now collect a real (or, by default, simulated) payment to renew
  a subscription, not just extend it for free — closing ADR 0007's payment
  deferral for the one flow it named.
- The app gained its first pluggable external-service provider pattern with
  a mock-by-default posture usable with zero account setup, and its first
  new dependency (`stripe`) that's inert unless explicitly opted into.
- `main.ts` (and the shared e2e test bootstrap) now capture the raw request
  body app-wide — a reusable precedent if another endpoint ever needs
  signature verification against exact bytes, though nothing else does yet.
- Quote-acceptance payment collection, paid initial subscription signup,
  refunds, dunning, and multi-currency remain open deferrals, each
  independently scoped whenever picked up.
