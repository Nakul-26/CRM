import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import Stripe from "stripe";
import { createTestApp } from "./setup/test-app";

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function registerOrg(app: INestApplication, orgName: string, ownerLabel: string) {
  const email = uniqueEmail(ownerLabel);
  const res = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send({ organizationName: orgName, fullName: `${ownerLabel} Owner`, email, password: "SuperSecret123" })
    .expect(201);
  return { email, accessToken: res.body.tokens.accessToken as string, user: res.body.user };
}

async function createAccount(app: INestApplication, token: string, name: string) {
  const res = await request(app.getHttpServer()).post("/api/v1/accounts").set("Authorization", `Bearer ${token}`).send({ name }).expect(201);
  return res.body.id as string;
}

async function createPlan(app: INestApplication, token: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/plans")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Pro", price: 49, billingInterval: "monthly", ...overrides })
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

describe("Payments (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("starts a mock checkout, completes it, and renews the subscription exactly once", async () => {
    const org = await registerOrg(app, "Initrode Payments", "ip");
    const accountId = await createAccount(app, org.accessToken, "Initrode Account");
    const plan = await createPlan(app, org.accessToken, { price: 49 });
    const subscription = await createSubscription(app, org.accessToken, accountId, plan.id);

    const { paymentId, checkoutUrl } = await startCheckout(app, org.accessToken, subscription.id);
    expect(checkoutUrl).toContain(`/pay/mock/${paymentId}`);

    const mockView = await request(app.getHttpServer()).get(`/api/v1/payments/mock/${paymentId}`).expect(200);
    expect(mockView.body).toEqual({ id: paymentId, amount: 49, currency: "usd", status: "pending", description: "Renewal — Pro" });
    // Curated public view — no org/account leakage.
    expect(mockView.body.organizationId).toBeUndefined();

    await request(app.getHttpServer()).post(`/api/v1/payments/mock/${paymentId}/complete`).expect(204);

    const afterFirst = await request(app.getHttpServer())
      .get(`/api/v1/subscriptions/${subscription.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(new Date(afterFirst.body.currentPeriodEnd).getTime()).toBeGreaterThan(new Date(subscription.currentPeriodEnd).getTime());

    const history = await request(app.getHttpServer())
      .get(`/api/v1/payments/subscriptions/${subscription.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({ id: paymentId, status: "succeeded", amount: 49 });

    // Idempotent: completing an already-succeeded payment again is a no-op — the subscription is only renewed once.
    await request(app.getHttpServer()).post(`/api/v1/payments/mock/${paymentId}/complete`).expect(204);
    const afterSecond = await request(app.getHttpServer())
      .get(`/api/v1/subscriptions/${subscription.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(afterSecond.body.currentPeriodEnd).toBe(afterFirst.body.currentPeriodEnd);
  });

  it("failing a mock checkout leaves the subscription unrenewed", async () => {
    const org = await registerOrg(app, "Failtrode Payments", "fp");
    const accountId = await createAccount(app, org.accessToken, "Failtrode Account");
    const plan = await createPlan(app, org.accessToken, { price: 20 });
    const subscription = await createSubscription(app, org.accessToken, accountId, plan.id);

    const { paymentId } = await startCheckout(app, org.accessToken, subscription.id);
    await request(app.getHttpServer()).post(`/api/v1/payments/mock/${paymentId}/fail`).expect(204);

    const view = await request(app.getHttpServer()).get(`/api/v1/payments/mock/${paymentId}`).expect(200);
    expect(view.body.status).toBe("failed");

    const after = await request(app.getHttpServer())
      .get(`/api/v1/subscriptions/${subscription.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(after.body.currentPeriodEnd).toBe(subscription.currentPeriodEnd);
  });

  it("rejects starting a checkout for a cancelled subscription", async () => {
    const org = await registerOrg(app, "Canceltrode Payments", "cp");
    const accountId = await createAccount(app, org.accessToken, "Canceltrode Account");
    const plan = await createPlan(app, org.accessToken, { price: 10 });
    const subscription = await createSubscription(app, org.accessToken, accountId, plan.id);

    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscription.id}/cancel`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/v1/payments/checkout")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subscriptionId: subscription.id })
      .expect(409);
  });

  it("requires subscriptions.edit to start a checkout", async () => {
    const org = await registerOrg(app, "Gatedtrode Payments", "gp");
    const accountId = await createAccount(app, org.accessToken, "Gatedtrode Account");
    const plan = await createPlan(app, org.accessToken, { price: 15 });
    const subscription = await createSubscription(app, org.accessToken, accountId, plan.id);

    const role = await request(app.getHttpServer())
      .post("/api/v1/roles")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "View Only", permissions: ["subscriptions.view"] })
      .expect(201);

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("view-only"), fullName: "View Only User", roleIds: [role.body.id] })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post("/api/v1/payments/checkout")
      .set("Authorization", `Bearer ${login.body.tokens.accessToken}`)
      .send({ subscriptionId: subscription.id })
      .expect(403);
  });

  it("verifies a genuinely signed Stripe webhook and rejects a bad signature", async () => {
    const org = await registerOrg(app, "Webhooktrode Payments", "wp");
    const accountId = await createAccount(app, org.accessToken, "Webhooktrode Account");
    const plan = await createPlan(app, org.accessToken, { price: 30 });
    const subscription = await createSubscription(app, org.accessToken, accountId, plan.id);
    const { paymentId } = await startCheckout(app, org.accessToken, subscription.id);

    const stripe = new Stripe("sk_test_unused_key_signing_is_local_only");
    const payload = JSON.stringify({
      id: "evt_test",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_webhook", metadata: { paymentId } } },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET as string,
    });

    // Bad signature first — must not mark the payment succeeded.
    await request(app.getHttpServer())
      .post("/api/v1/payments/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=deadbeef")
      .send(payload)
      .expect(400);

    const stillPending = await request(app.getHttpServer()).get(`/api/v1/payments/mock/${paymentId}`).expect(200);
    expect(stillPending.body.status).toBe("pending");

    await request(app.getHttpServer())
      .post("/api/v1/payments/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload)
      .expect(200);

    const history = await request(app.getHttpServer())
      .get(`/api/v1/payments/subscriptions/${subscription.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(history.body[0]).toMatchObject({ id: paymentId, status: "succeeded" });
  });
});
