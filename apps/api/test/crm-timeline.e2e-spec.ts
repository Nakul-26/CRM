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

describe("CRM Timeline (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("merges logged activities and account/contact events, ordered most-recent-first, with type filtering", async () => {
    const org = await registerOrg(app, "Sterling Cooper", "sc");

    const account = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Lucky Strike" })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/accounts/${account.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ industry: "Tobacco" })
      .expect(200);

    const contact = await request(app.getHttpServer())
      .post("/api/v1/contacts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.body.id, firstName: "Don", lastName: "Draper" })
      .expect(201);

    const activity = await request(app.getHttpServer())
      .post("/api/v1/activities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.body.id, type: "call", subject: "Pitch call" })
      .expect(201);

    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.body.id}/timeline`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);

    const types = timeline.body.map((e: { type: string }) => e.type);
    // account.created, account.updated, contact.created (via its accountId), and the logged call.
    expect(types).toEqual(expect.arrayContaining(["account.created", "account.updated", "contact.created", "call"]));

    // Most-recent-first ordering.
    const occurredAts = timeline.body.map((e: { occurredAt: string }) => e.occurredAt);
    const sorted = [...occurredAts].sort().reverse();
    expect(occurredAts).toEqual(sorted);

    // Filtering by type narrows to just the logged activity.
    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.body.id}/timeline?type=call`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].id).toBe(activity.body.id);

    void contact; // created above to also emit a contact.created timeline event
  });

  it("shows opportunity.created/won events on the account timeline (proves the TIMELINE_EVENT_TYPES extension)", async () => {
    const org = await registerOrg(app, "Duck Phillips Sales", "dps");

    const account = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Jaguar Motors" })
      .expect(201);

    const opportunity = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Jaguar Ad Campaign", accountId: account.body.id })
      .expect(201);

    const pipelines = await request(app.getHttpServer())
      .get("/api/v1/pipelines")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const stages = await request(app.getHttpServer())
      .get(`/api/v1/pipelines/${pipelines.body[0].id}/stages`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const closedWon = stages.body.find((s: { name: string }) => s.name === "Closed Won");

    await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${opportunity.body.id}/stage`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ stageId: closedWon.id })
      .expect(201);

    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.body.id}/timeline`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);

    const types = timeline.body.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(["opportunity.created", "opportunity.stage_changed", "opportunity.won"]));

    const createdEntry = timeline.body.find((e: { type: string }) => e.type === "opportunity.created");
    expect(createdEntry.summary).toBe('Opportunity "Jaguar Ad Campaign" was created');
  });

  it("shows quote.created/sent/accepted events on the account timeline (third proof of the TIMELINE_EVENT_TYPES extension)", async () => {
    const org = await registerOrg(app, "Sterling Cooper Quotes", "scq");

    const account = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Lucky Strike Tobacco" })
      .expect(201);

    const quote = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.body.id, lineItems: [{ name: "Ad Package", quantity: 1, unitPrice: 5000 }] })
      .expect(201);

    const sent = await request(app.getHttpServer())
      .post(`/api/v1/quotes/${quote.body.quote.id}/send`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);

    await request(app.getHttpServer()).post(`/api/v1/public/quotes/${sent.body.quote.shareToken}/accept`).expect(201);

    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.body.id}/timeline`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);

    const types = timeline.body.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(["quote.created", "quote.sent", "quote.accepted"]));

    const sentEntry = timeline.body.find((e: { type: string }) => e.type === "quote.sent");
    expect(sentEntry.summary).toBe("Quote was sent");
    const acceptedEntry = timeline.body.find((e: { type: string }) => e.type === "quote.accepted");
    expect(acceptedEntry.summary).toBe("Quote was accepted");
  });

  it("shows ticket.created/status_changed/comment_added events on the account timeline (fourth proof of the TIMELINE_EVENT_TYPES extension)", async () => {
    const org = await registerOrg(app, "Sterling Cooper Support", "scs");

    const account = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Lucky Strike Support" })
      .expect(201);

    const ticket = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "Billing question", accountId: account.body.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket.body.id}/status`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ status: "in_progress" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket.body.id}/comments`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ body: "Looking into your invoice", isPublic: true })
      .expect(201);

    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.body.id}/timeline`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);

    const types = timeline.body.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(["ticket.created", "ticket.status_changed", "ticket.comment_added"]));

    const createdEntry = timeline.body.find((e: { type: string }) => e.type === "ticket.created");
    expect(createdEntry.summary).toBe('Ticket "Billing question" was created');
    const statusEntry = timeline.body.find((e: { type: string }) => e.type === "ticket.status_changed");
    expect(statusEntry.summary).toBe('Ticket status changed to "in_progress"');
    const commentEntry = timeline.body.find((e: { type: string }) => e.type === "ticket.comment_added");
    expect(commentEntry.summary).toBe("New reply on a ticket");
  });

  it("shows subscription.created/renewed/cancelled events on the account timeline (fifth proof of the TIMELINE_EVENT_TYPES extension)", async () => {
    const org = await registerOrg(app, "Sterling Cooper Subscriptions", "scsub");

    const account = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Lucky Strike Subscriptions" })
      .expect(201);

    const plan = await request(app.getHttpServer())
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Timeline Plan", price: 20 })
      .expect(201);

    const subscription = await request(app.getHttpServer())
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.body.id, planId: plan.body.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscription.body.id}/renew`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${subscription.body.id}/cancel`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);

    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.body.id}/timeline`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);

    const types = timeline.body.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(["subscription.created", "subscription.renewed", "subscription.cancelled"]));

    const createdEntry = timeline.body.find((e: { type: string }) => e.type === "subscription.created");
    expect(createdEntry.summary).toBe('Subscribed to "Timeline Plan"');
    const renewedEntry = timeline.body.find((e: { type: string }) => e.type === "subscription.renewed");
    expect(renewedEntry.summary).toBe("Subscription was renewed");
    const cancelledEntry = timeline.body.find((e: { type: string }) => e.type === "subscription.cancelled");
    expect(cancelledEntry.summary).toBe("Subscription was cancelled");
  });

  it("404s when an org requests another org's account timeline", async () => {
    const orgA = await registerOrg(app, "Cutler Gleason & Chaough", "cg");
    const orgB = await registerOrg(app, "Duck Phillips CRM", "dp");

    const account = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ name: "Org A's account" })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.body.id}/timeline`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);
  });
});
