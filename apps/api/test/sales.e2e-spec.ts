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
  const res = await request(app.getHttpServer())
    .post("/api/v1/accounts")
    .set("Authorization", `Bearer ${token}`)
    .send({ name })
    .expect(201);
  return res.body as { id: string; name: string };
}

describe("Sales — Opportunities & Pipelines (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("lazily seeds a default pipeline with the brief's 6 example stages", async () => {
    const org = await registerOrg(app, "Initech Sales", "is");

    const pipelines = await request(app.getHttpServer())
      .get("/api/v1/pipelines")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(pipelines.body).toHaveLength(1);
    expect(pipelines.body[0].isDefault).toBe(true);
    expect(pipelines.body[0].name).toBe("Sales Pipeline");

    const stages = await request(app.getHttpServer())
      .get(`/api/v1/pipelines/${pipelines.body[0].id}/stages`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(stages.body.map((s: { name: string }) => s.name)).toEqual([
      "Qualification",
      "Discovery",
      "Proposal",
      "Negotiation",
      "Closed Won",
      "Closed Lost",
    ]);
    expect(stages.body.find((s: { name: string }) => s.name === "Closed Won").isWon).toBe(true);
    expect(stages.body.find((s: { name: string }) => s.name === "Closed Lost").isLost).toBe(true);

    // Calling it again (e.g. creating an opportunity) must not create a second default pipeline.
    const again = await request(app.getHttpServer())
      .get("/api/v1/pipelines")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(again.body).toHaveLength(1);
  });

  it("creates, lists, updates, and soft-deletes an opportunity, defaulting pipeline/stage/probability", async () => {
    const org = await registerOrg(app, "Vandelay Sales", "vs");
    const account = await createAccount(app, org.accessToken, "Vandelay Industries");

    const created = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Latex Deal", accountId: account.id, value: 50000, currency: "USD" })
      .expect(201);
    expect(created.body.name).toBe("Latex Deal");
    expect(created.body.outcome).toBe("open");
    expect(created.body.probability).toBe(10); // defaulted from Qualification stage

    const list = await request(app.getHttpServer())
      .get("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(list.body.map((o: { id: string }) => o.id)).toContain(created.body.id);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/opportunities/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ value: 75000 })
      .expect(200);
    expect(updated.body.value).toBe(75000);

    await request(app.getHttpServer())
      .delete(`/api/v1/opportunities/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/opportunities/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(404);
  });

  it("404s when an org tries to read another org's opportunity, and rejects an account from a different org", async () => {
    const orgA = await registerOrg(app, "Kramerica Sales", "ks");
    const orgB = await registerOrg(app, "Pendant Sales", "ps");
    const accountA = await createAccount(app, orgA.accessToken, "Kramerica Industries");

    const opp = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ name: "Org A deal", accountId: accountA.id })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/opportunities/${opp.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);

    // Org B can't create an opportunity against Org A's account.
    await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ name: "Cross-tenant attempt", accountId: accountA.id })
      .expect(404);
  });

  it("moves an opportunity through stages, updates probability/outcome, and enforces the closed-is-terminal guard", async () => {
    const org = await registerOrg(app, "Massive Dynamic Sales", "mds");
    const account = await createAccount(app, org.accessToken, "Massive Dynamic");

    const opp = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Big Deal", accountId: account.id, value: 100000 })
      .expect(201);

    const pipelines = await request(app.getHttpServer())
      .get("/api/v1/pipelines")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const stages = await request(app.getHttpServer())
      .get(`/api/v1/pipelines/${pipelines.body[0].id}/stages`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const proposal = stages.body.find((s: { name: string }) => s.name === "Proposal");
    const closedWon = stages.body.find((s: { name: string }) => s.name === "Closed Won");
    const closedLost = stages.body.find((s: { name: string }) => s.name === "Closed Lost");

    const moved = await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${opp.body.id}/stage`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ stageId: proposal.id })
      .expect(201);
    expect(moved.body.stageId).toBe(proposal.id);
    expect(moved.body.probability).toBe(50);
    expect(moved.body.outcome).toBe("open");

    const won = await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${opp.body.id}/stage`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ stageId: closedWon.id })
      .expect(201);
    expect(won.body.outcome).toBe("won");
    expect(won.body.probability).toBe(100);
    expect(won.body.closedAt).not.toBeNull();

    // Closed is terminal — no further stage moves, even back to an earlier stage.
    await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${opp.body.id}/stage`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ stageId: closedLost.id })
      .expect(400);
  });

  it("rejects moving an opportunity to a stage from a different pipeline", async () => {
    const org = await registerOrg(app, "Pied Piper Sales", "pps");
    const account = await createAccount(app, org.accessToken, "Pied Piper");

    const opp = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Compression Deal", accountId: account.id })
      .expect(201);

    const otherPipeline = await request(app.getHttpServer())
      .post("/api/v1/pipelines")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Enterprise Pipeline" })
      .expect(201);
    const otherStage = await request(app.getHttpServer())
      .post(`/api/v1/pipelines/${otherPipeline.body.id}/stages`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Custom Stage", order: 1, probability: 20 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${opp.body.id}/stage`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ stageId: otherStage.body.id })
      .expect(400);
  });

  it("computes summary stats and monthly forecast, and records stage history", async () => {
    const org = await registerOrg(app, "Stark Industries Sales", "sis");
    const account = await createAccount(app, org.accessToken, "Stark Industries");

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

    const closeDate = "2026-09-15T00:00:00.000Z";

    const won1 = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Won Deal 1", accountId: account.id, value: 10000, expectedCloseDate: closeDate })
      .expect(201);
    const won2 = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Won Deal 2", accountId: account.id, value: 20000, expectedCloseDate: closeDate })
      .expect(201);
    const lost1 = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Lost Deal", accountId: account.id, value: 5000, expectedCloseDate: closeDate })
      .expect(201);
    const open1 = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Open Deal", accountId: account.id, value: 8000, expectedCloseDate: closeDate })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${won1.body.id}/stage`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ stageId: closedWon.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${won2.body.id}/stage`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ stageId: closedWon.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${lost1.body.id}/stage`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ stageId: closedLost.id })
      .expect(201);

    const summary = await request(app.getHttpServer())
      .get("/api/v1/opportunities/stats/summary")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(summary.body.wonCount).toBe(2);
    expect(summary.body.lostCount).toBe(1);
    expect(summary.body.openCount).toBe(1);
    expect(summary.body.wonRevenue).toBe(30000);
    expect(summary.body.lostRevenue).toBe(5000);
    expect(summary.body.winRate).toBeCloseTo(2 / 3);
    expect(summary.body.averageDealSize).toBe(15000);
    expect(summary.body.totalPipelineValue).toBe(8000); // only the still-open deal

    const forecast = await request(app.getHttpServer())
      .get("/api/v1/opportunities/stats/forecast")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    // Forecast only counts open opportunities against their expected close month.
    expect(forecast.body).toEqual([{ month: "2026-09", value: 8000, weightedValue: 800, count: 1 }]);

    const history = await request(app.getHttpServer())
      .get(`/api/v1/opportunities/${won1.body.id}/stage-history`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].toStageId).toBe(closedWon.id);
    expect(history.body[0].fromStageId).toBe(stages.body[0].id); // Qualification — the default first stage on create
  });

  it("enforces RBAC: a Member can create/edit opportunities but cannot delete them or manage pipelines", async () => {
    const org = await registerOrg(app, "Hooli Sales", "hs");
    const account = await createAccount(app, org.accessToken, "Hooli");

    const roles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-sales"), fullName: "Gavin Member", roleIds: [memberRole.id] })
      .expect(201);

    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);
    const memberToken = memberLogin.body.tokens.accessToken as string;

    const opp = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Member-created deal", accountId: account.id })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/opportunities/${opp.body.id}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ notes: "Following up next week" })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/opportunities/${opp.body.id}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post("/api/v1/pipelines")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Blocked pipeline" })
      .expect(403);
  });
});
