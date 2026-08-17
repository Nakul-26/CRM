import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createTestApp } from "./setup/test-app";
import { DATABASE_CONNECTION, type Database } from "../src/database/database.module";
import { subscriptions } from "../src/database/schema";

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
    .send({ name: "Pro", price: 99, billingInterval: "monthly", ...overrides })
    .expect(201);
  return res.body as { id: string; price: number; billingInterval: string; name: string };
}

describe("Subscriptions (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a subscription, snapshotting plan fields and computing the period end for a monthly plan", async () => {
    const org = await registerOrg(app, "Initrode Subscriptions", "is");
    const accountId = await createAccount(app, org.accessToken, "Initrode Account");
    const plan = await createPlan(app, org.accessToken, { name: "Monthly Pro", price: 49, billingInterval: "monthly" });

    const created = await request(app.getHttpServer())
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId, planId: plan.id })
      .expect(201);

    expect(created.body.status).toBe("active");
    expect(created.body.planName).toBe("Monthly Pro");
    expect(created.body.price).toBe(49);
    expect(created.body.billingInterval).toBe("monthly");
    expect(created.body.currentPeriodReminderSent).toBe(false);

    const start = new Date(created.body.currentPeriodStart);
    const end = new Date(created.body.currentPeriodEnd);
    const expectedEnd = new Date(start);
    expectedEnd.setMonth(expectedEnd.getMonth() + 1);
    expect(end.getTime()).toBe(expectedEnd.getTime());
  });

  it("computes the period end correctly for a yearly plan", async () => {
    const org = await registerOrg(app, "Massive Dynamic Subscriptions", "mds");
    const accountId = await createAccount(app, org.accessToken, "Massive Dynamic Account");
    const plan = await createPlan(app, org.accessToken, { name: "Annual Pro", price: 500, billingInterval: "yearly" });

    const created = await request(app.getHttpServer())
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId, planId: plan.id })
      .expect(201);

    const start = new Date(created.body.currentPeriodStart);
    const end = new Date(created.body.currentPeriodEnd);
    const expectedEnd = new Date(start);
    expectedEnd.setFullYear(expectedEnd.getFullYear() + 1);
    expect(end.getTime()).toBe(expectedEnd.getTime());
  });

  it("editing a plan's price later never changes an already-created subscription's snapshot", async () => {
    const org = await registerOrg(app, "Umbrella Corp Subscriptions", "ucs");
    const accountId = await createAccount(app, org.accessToken, "Umbrella Account");
    const plan = await createPlan(app, org.accessToken, { name: "Snapshot Plan", price: 10 });

    const created = await request(app.getHttpServer())
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId, planId: plan.id })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/plans/${plan.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ price: 999 })
      .expect(200);

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/subscriptions/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(fetched.body.price).toBe(10);
  });

  it("rejects cancelling an already-cancelled subscription, and renewing a cancelled subscription", async () => {
    const org = await registerOrg(app, "Wayne Enterprises Subscriptions", "wes");
    const accountId = await createAccount(app, org.accessToken, "Wayne Account");
    const plan = await createPlan(app, org.accessToken);

    const created = await request(app.getHttpServer())
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId, planId: plan.id })
      .expect(201);

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);
    expect(cancelled.body.status).toBe("cancelled");
    expect(cancelled.body.cancelledAt).not.toBeNull();

    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${created.body.id}/renew`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(409);
  });

  it("lazily transitions an overdue active subscription to lapsed on read, and renew brings it back to active", async () => {
    const org = await registerOrg(app, "Stark Industries Subscriptions", "sis");
    const accountId = await createAccount(app, org.accessToken, "Stark Account");
    const plan = await createPlan(app, org.accessToken);

    const created = await request(app.getHttpServer())
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId, planId: plan.id })
      .expect(201);

    const db = app.get<Database>(DATABASE_CONNECTION);
    const past = new Date(Date.now() - 60_000);
    await db.update(subscriptions).set({ currentPeriodEnd: past }).where(eq(subscriptions.id, created.body.id));

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/subscriptions/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(fetched.body.status).toBe("lapsed");

    const renewed = await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${created.body.id}/renew`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);
    expect(renewed.body.status).toBe("active");
    expect(new Date(renewed.body.currentPeriodEnd).getTime()).toBeGreaterThan(past.getTime());
  });

  it("404s when an org tries to read another org's subscription", async () => {
    const orgA = await registerOrg(app, "Acme A Subscriptions", "aas");
    const orgB = await registerOrg(app, "Acme B Subscriptions", "abs");
    const accountId = await createAccount(app, orgA.accessToken, "Acme A Account");
    const plan = await createPlan(app, orgA.accessToken);

    const created = await request(app.getHttpServer())
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ accountId, planId: plan.id })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/subscriptions/${created.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);
  });

  it("enforces RBAC: a Member can create/cancel/renew subscriptions but cannot delete or manage plans", async () => {
    const org = await registerOrg(app, "Pepper Industries Subscriptions", "pis");
    const accountId = await createAccount(app, org.accessToken, "Pepper Account");
    const plan = await createPlan(app, org.accessToken);

    const roles = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", `Bearer ${org.accessToken}`).expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-subs"), fullName: "Pepper Member", roleIds: [memberRole.id] })
      .expect(201);
    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);
    const memberToken = memberLogin.body.tokens.accessToken as string;

    const created = await request(app.getHttpServer())
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ accountId, planId: plan.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${created.body.id}/renew`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/subscriptions/${created.body.id}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Member Plan", price: 5 })
      .expect(403);
  });
});
