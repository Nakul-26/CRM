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

async function createOpportunity(app: INestApplication, token: string, accountId: string, name: string) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/opportunities")
    .set("Authorization", `Bearer ${token}`)
    .send({ name, accountId, value: 10000 })
    .expect(201);
  return res.body as { id: string; pipelineId: string; stageId: string; outcome: string };
}

async function createSentQuote(app: INestApplication, token: string, accountId: string, opportunityId?: string) {
  const created = await request(app.getHttpServer())
    .post("/api/v1/quotes")
    .set("Authorization", `Bearer ${token}`)
    .send({ accountId, opportunityId, lineItems: [{ name: "Widget", quantity: 3, unitPrice: 20 }] })
    .expect(201);
  const sent = await request(app.getHttpServer())
    .post(`/api/v1/quotes/${created.body.quote.id}/send`)
    .set("Authorization", `Bearer ${token}`)
    .expect(201);
  return sent.body.quote as { id: string; shareToken: string };
}

describe("Sales automation — quote acceptance auto-advances a linked Opportunity (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("moves the linked Opportunity to the pipeline's Closed Won stage when its quote is accepted", async () => {
    const org = await registerOrg(app, "Automation Co", "auto");
    const account = await createAccount(app, org.accessToken, "Automation Account");
    const opportunity = await createOpportunity(app, org.accessToken, account.id, "Linked Deal");
    const quote = await createSentQuote(app, org.accessToken, account.id, opportunity.id);

    const pipelines = await request(app.getHttpServer())
      .get("/api/v1/pipelines")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const stages = await request(app.getHttpServer())
      .get(`/api/v1/pipelines/${pipelines.body[0].id}/stages`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const closedWon = stages.body.find((s: { name: string }) => s.name === "Closed Won");

    await request(app.getHttpServer()).post(`/api/v1/public/quotes/${quote.shareToken}/accept`).expect(201);

    // The listener runs off the same in-process event emitter synchronously —
    // no polling/sleep needed before asserting.
    const updated = await request(app.getHttpServer())
      .get(`/api/v1/opportunities/${opportunity.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(updated.body.outcome).toBe("won");
    expect(updated.body.stageId).toBe(closedWon.id);
    expect(updated.body.closedAt).not.toBeNull();

    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.id}/timeline`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const types = timeline.body.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(["quote.accepted", "opportunity.stage_changed", "opportunity.won"]));
  });

  it("does not touch an Opportunity that was already closed before the quote was accepted", async () => {
    const org = await registerOrg(app, "Already Closed Co", "alc");
    const account = await createAccount(app, org.accessToken, "Already Closed Account");
    const opportunity = await createOpportunity(app, org.accessToken, account.id, "Pre-closed Deal");
    const quote = await createSentQuote(app, org.accessToken, account.id, opportunity.id);

    const pipelines = await request(app.getHttpServer())
      .get("/api/v1/pipelines")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const stages = await request(app.getHttpServer())
      .get(`/api/v1/pipelines/${pipelines.body[0].id}/stages`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const closedLost = stages.body.find((s: { name: string }) => s.name === "Closed Lost");

    // Close the opportunity as Lost before the quote is ever accepted.
    await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${opportunity.id}/stage`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ stageId: closedLost.id })
      .expect(201);

    await request(app.getHttpServer()).post(`/api/v1/public/quotes/${quote.shareToken}/accept`).expect(201);

    const unchanged = await request(app.getHttpServer())
      .get(`/api/v1/opportunities/${opportunity.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(unchanged.body.outcome).toBe("lost");
    expect(unchanged.body.stageId).toBe(closedLost.id);
  });

  it("accepting a quote with no linked Opportunity succeeds without error", async () => {
    const org = await registerOrg(app, "No Link Co", "nlc");
    const account = await createAccount(app, org.accessToken, "No Link Account");
    const quote = await createSentQuote(app, org.accessToken, account.id);

    const accepted = await request(app.getHttpServer()).post(`/api/v1/public/quotes/${quote.shareToken}/accept`).expect(201);
    expect(accepted.body.quote.status).toBe("accepted");
  });
});
