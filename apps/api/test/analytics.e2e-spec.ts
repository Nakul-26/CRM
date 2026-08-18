import type { INestApplication } from "@nestjs/common";
import request from "supertest";
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
  return res.body as { id: string; name: string };
}

async function createPlan(app: INestApplication, token: string, overrides: Record<string, unknown>) {
  const res = await request(app.getHttpServer()).post("/api/v1/plans").set("Authorization", `Bearer ${token}`).send(overrides).expect(201);
  return res.body as { id: string };
}

describe("Analytics dashboard (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("aggregates pipeline value, win rate, and MRR/ARR across opportunities and subscriptions", async () => {
    const org = await registerOrg(app, "Analytics Co", "ac");
    const account = await createAccount(app, org.accessToken, "Analytics Account");

    const pipelines = await request(app.getHttpServer())
      .get("/api/v1/pipelines")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const stages = await request(app.getHttpServer())
      .get(`/api/v1/pipelines/${pipelines.body[0].id}/stages`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const closedWon = stages.body.find((s: { name: string }) => s.name === "Closed Won");
    const closedLost = stages.body.find((s: { name: string }) => s.name === "Closed Lost");

    const won = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Won Deal", accountId: account.id, value: 10000 })
      .expect(201);
    const lost = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Lost Deal", accountId: account.id, value: 5000 })
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Open Deal", accountId: account.id, value: 8000 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${won.body.id}/stage`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ stageId: closedWon.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${lost.body.id}/stage`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ stageId: closedLost.id })
      .expect(201);

    const monthlyPlan = await createPlan(app, org.accessToken, { name: "Monthly", price: 100, billingInterval: "monthly" });
    const yearlyPlan = await createPlan(app, org.accessToken, { name: "Yearly", price: 1200, billingInterval: "yearly" });

    const monthlySub = await request(app.getHttpServer())
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, planId: monthlyPlan.id })
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, planId: yearlyPlan.id })
      .expect(201);

    const dashboard = await request(app.getHttpServer()).get("/api/v1/analytics/dashboard").set("Authorization", `Bearer ${org.accessToken}`).expect(200);

    expect(dashboard.body.openPipelineValue).toBe(8000);
    expect(dashboard.body.weightedPipelineValue).toBe(800); // 8000 * 10% (default Qualification stage probability)
    expect(dashboard.body.winRate).toBeCloseTo(0.5); // 1 won / (1 won + 1 lost)
    expect(dashboard.body.openOpportunitiesCount).toBe(1);
    expect(dashboard.body.mrr).toBe(200); // 100 monthly + 1200/12 yearly
    expect(dashboard.body.arr).toBe(2400);
    expect(dashboard.body.activeSubscriptionsCount).toBe(2);

    // Cancelling a subscription removes it from the active MRR/count totals.
    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${monthlySub.body.id}/cancel`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);

    const afterCancel = await request(app.getHttpServer())
      .get("/api/v1/analytics/dashboard")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(afterCancel.body.mrr).toBe(100);
    expect(afterCancel.body.arr).toBe(1200);
    expect(afterCancel.body.activeSubscriptionsCount).toBe(1);
  });

  it("keeps dashboard totals isolated per organization", async () => {
    const org = await registerOrg(app, "Analytics Empty Co", "aec");

    const dashboard = await request(app.getHttpServer()).get("/api/v1/analytics/dashboard").set("Authorization", `Bearer ${org.accessToken}`).expect(200);

    expect(dashboard.body).toEqual({
      openPipelineValue: 0,
      weightedPipelineValue: 0,
      winRate: 0,
      openOpportunitiesCount: 0,
      mrr: 0,
      arr: 0,
      activeSubscriptionsCount: 0,
    });
  });

  it("requires authentication, and grants a Member the analytics.view permission by default", async () => {
    const org = await registerOrg(app, "Analytics RBAC Co", "arc");

    await request(app.getHttpServer()).get("/api/v1/analytics/dashboard").expect(401);

    const roles = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", `Bearer ${org.accessToken}`).expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-analytics"), fullName: "Analytics Member", roleIds: [memberRole.id] })
      .expect(201);
    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);

    await request(app.getHttpServer())
      .get("/api/v1/analytics/dashboard")
      .set("Authorization", `Bearer ${memberLogin.body.tokens.accessToken}`)
      .expect(200);
  });
});
