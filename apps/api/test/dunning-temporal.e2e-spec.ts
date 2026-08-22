// Must run before any other import — test-app.ts reads these via `??=`, so
// setting them here (before it's imported, even transitively) is what makes
// this one spec file exercise the real Temporal-backed dunning path while
// every other spec file keeps using the default Postgres/cron orchestrator.
process.env.WORKFLOW_ENGINE = "temporal";
process.env.TEMPORAL_ADDRESS ??= "localhost:7234";
// A real dunning schedule is day-scale — override to a few seconds so this
// e2e test proves a genuine start-workflow -> retry -> outcome round trip
// against the real server without waiting out real days. See
// docs/decisions/0016-temporal-dunning-phase16-scope.md.
process.env.DUNNING_RETRY_DELAYS_MS ??= "2000,2000,2000";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./setup/test-app";

// Temporal's worker bootstrap (webpack-bundling the workflow) and its own
// JVM-free but still non-trivial cold-start is slower than RabbitMQ/
// OpenSearch's — give this file's tests more headroom than Jest's default.
jest.setTimeout(60000);

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function registerOrg(app: INestApplication, orgName: string, ownerLabel: string) {
  const email = uniqueEmail(ownerLabel);
  const res = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send({ organizationName: orgName, fullName: `${ownerLabel} Owner`, email, password: "SuperSecret123" })
    .expect(201);
  return { accessToken: res.body.tokens.accessToken as string };
}

async function createAccount(app: INestApplication, token: string, name: string) {
  const res = await request(app.getHttpServer()).post("/api/v1/accounts").set("Authorization", `Bearer ${token}`).send({ name }).expect(201);
  return res.body.id as string;
}

async function createPlan(app: INestApplication, token: string, price: number) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/plans")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Pro", price, billingInterval: "monthly" })
    .expect(201);
  return res.body as { id: string };
}

async function createSubscription(app: INestApplication, token: string, accountId: string, planId: string) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/subscriptions")
    .set("Authorization", `Bearer ${token}`)
    .send({ accountId, planId })
    .expect(201);
  return res.body as { id: string; currentPeriodEnd: string };
}

async function startCheckout(app: INestApplication, token: string, subscriptionId: string) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/payments/checkout")
    .set("Authorization", `Bearer ${token}`)
    .send({ subscriptionId })
    .expect(201);
  return res.body as { paymentId: string; checkoutUrl: string };
}

async function failMock(app: INestApplication, paymentId: string) {
  await request(app.getHttpServer()).post(`/api/v1/payments/mock/${paymentId}/fail`).expect(204);
}

async function completeMock(app: INestApplication, paymentId: string) {
  await request(app.getHttpServer()).post(`/api/v1/payments/mock/${paymentId}/complete`).expect(204);
}

/**
 * A dunning retry attempt creates a new payment on the subscription some
 * time after the previous one failed (driven by the real Temporal
 * workflow's sleep) — poll payment history for a new pending payment id
 * that isn't one we've already seen.
 */
async function waitForNextAttempt(app: INestApplication, token: string, subscriptionId: string, seenPaymentIds: Set<string>, timeoutMs = 20000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/payments/subscriptions/${subscriptionId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const pending = (res.body as { id: string; status: string }[]).find((p) => p.status === "pending" && !seenPaymentIds.has(p.id));
    if (pending) return pending.id;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for the next dunning retry attempt on subscription ${subscriptionId}`);
}

async function waitForSubscriptionStatus(app: INestApplication, token: string, subscriptionId: string, status: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app.getHttpServer()).get(`/api/v1/subscriptions/${subscriptionId}`).set("Authorization", `Bearer ${token}`).expect(200);
    if (res.body.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for subscription ${subscriptionId} to reach status "${status}"`);
}

describe("Dunning over Temporal (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("retries a failed renewal charge via a real Temporal workflow and recovers when a retry succeeds", async () => {
    const org = await registerOrg(app, "Dunning Recovery Co", "dunning-recover");
    const accountId = await createAccount(app, org.accessToken, "Recovery Account");
    const plan = await createPlan(app, org.accessToken, 40);
    const subscription = await createSubscription(app, org.accessToken, accountId, plan.id);

    const first = await startCheckout(app, org.accessToken, subscription.id);
    await failMock(app, first.paymentId);

    const seen = new Set([first.paymentId]);
    const retryPaymentId = await waitForNextAttempt(app, org.accessToken, subscription.id, seen);
    await completeMock(app, retryPaymentId);

    await waitForSubscriptionStatus(app, org.accessToken, subscription.id, "active");
    const after = await request(app.getHttpServer()).get(`/api/v1/subscriptions/${subscription.id}`).set("Authorization", `Bearer ${org.accessToken}`).expect(200);
    expect(new Date(after.body.currentPeriodEnd).getTime()).toBeGreaterThan(new Date(subscription.currentPeriodEnd).getTime());
  });

  it("cancels the subscription once every retry attempt fails", async () => {
    const org = await registerOrg(app, "Dunning Exhaust Co", "dunning-exhaust");
    const accountId = await createAccount(app, org.accessToken, "Exhaust Account");
    const plan = await createPlan(app, org.accessToken, 25);
    const subscription = await createSubscription(app, org.accessToken, accountId, plan.id);

    const first = await startCheckout(app, org.accessToken, subscription.id);
    await failMock(app, first.paymentId);

    const seen = new Set([first.paymentId]);
    for (let i = 0; i < 3; i++) {
      const paymentId = await waitForNextAttempt(app, org.accessToken, subscription.id, seen);
      seen.add(paymentId);
      await failMock(app, paymentId);
    }

    await waitForSubscriptionStatus(app, org.accessToken, subscription.id, "cancelled");
  });
});
