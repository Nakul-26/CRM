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

/** Invites a second user in the same org with the Owner role, so they need no extra permission grants. */
async function inviteSecondUser(app: INestApplication, ownerToken: string, label: string) {
  const roles = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", `Bearer ${ownerToken}`).expect(200);
  const ownerRole = roles.body.find((r: { name: string }) => r.name === "Owner");

  const invited = await request(app.getHttpServer())
    .post("/api/v1/users/invite")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ email: uniqueEmail(label), fullName: `${label} User`, roleIds: [ownerRole.id] })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
    .expect(200);
  return { id: invited.body.user.id as string, accessToken: login.body.tokens.accessToken as string };
}

async function createAccount(app: INestApplication, token: string, name: string) {
  const res = await request(app.getHttpServer()).post("/api/v1/accounts").set("Authorization", `Bearer ${token}`).send({ name }).expect(201);
  return res.body as { id: string; name: string };
}

async function createOpportunity(app: INestApplication, token: string, accountId: string, name: string, ownerId?: string) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/opportunities")
    .set("Authorization", `Bearer ${token}`)
    .send({ name, accountId, value: 5000, ownerId })
    .expect(201);
  return res.body as { id: string; pipelineId: string; ownerId: string | null };
}

async function moveToStageNamed(app: INestApplication, token: string, opportunityId: string, pipelineId: string, stageName: string) {
  const stages = await request(app.getHttpServer())
    .get(`/api/v1/pipelines/${pipelineId}/stages`)
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
  const target = stages.body.find((s: { name: string }) => s.name === stageName);
  await request(app.getHttpServer())
    .post(`/api/v1/opportunities/${opportunityId}/stage`)
    .set("Authorization", `Bearer ${token}`)
    .send({ stageId: target.id })
    .expect(201);
}

async function createSentQuote(app: INestApplication, token: string, accountId: string) {
  const created = await request(app.getHttpServer())
    .post("/api/v1/quotes")
    .set("Authorization", `Bearer ${token}`)
    .send({ accountId, lineItems: [{ name: "Widget", quantity: 1, unitPrice: 100 }] })
    .expect(201);
  const sent = await request(app.getHttpServer())
    .post(`/api/v1/quotes/${created.body.quote.id}/send`)
    .set("Authorization", `Bearer ${token}`)
    .expect(201);
  return sent.body.quote as { id: string; shareToken: string };
}

function listNotifications(app: INestApplication, token: string) {
  return request(app.getHttpServer()).get("/api/v1/notifications").set("Authorization", `Bearer ${token}`).expect(200);
}

describe("Notifications (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("notifies a ticket's assignee, but not when a user assigns a ticket to themself", async () => {
    const org = await registerOrg(app, "Notify Tickets Co", "nt");
    const second = await inviteSecondUser(app, org.accessToken, "nt-second");
    const account = await createAccount(app, org.accessToken, "Notify Account");

    const ticket = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "Help needed", accountId: account.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket.body.id}/assign`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ assigneeId: second.id })
      .expect(201);

    const secondNotifications = await listNotifications(app, second.accessToken);
    expect(secondNotifications.body).toHaveLength(1);
    expect(secondNotifications.body[0]).toMatchObject({ type: "ticket.assigned", isRead: false, link: `/support/tickets/${ticket.body.id}` });

    const ownerNotifications = await listNotifications(app, org.accessToken);
    expect(ownerNotifications.body).toHaveLength(0);

    // Self-assignment: the actor assigns the ticket to themself.
    const ticket2 = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "Self assign", accountId: account.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket2.body.id}/assign`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ assigneeId: org.user.id })
      .expect(201);
    const afterSelfAssign = await listNotifications(app, org.accessToken);
    expect(afterSelfAssign.body).toHaveLength(0);
  });

  it("notifies an Opportunity's owner when it's won or lost by someone else, but not by the owner themself", async () => {
    const org = await registerOrg(app, "Notify Sales Co", "ns");
    const second = await inviteSecondUser(app, org.accessToken, "ns-second");
    const account = await createAccount(app, org.accessToken, "Notify Sales Account");

    const opportunity = await createOpportunity(app, org.accessToken, account.id, "Owned by second", second.id);
    await moveToStageNamed(app, org.accessToken, opportunity.id, opportunity.pipelineId, "Closed Won");

    const secondNotifications = await listNotifications(app, second.accessToken);
    expect(secondNotifications.body).toHaveLength(1);
    expect(secondNotifications.body[0]).toMatchObject({ type: "opportunity.won", link: `/sales/opportunities/${opportunity.id}` });

    // Owner closes their own deal — no self-notification.
    const ownOpportunity = await createOpportunity(app, org.accessToken, account.id, "Owned by actor", org.user.id);
    await moveToStageNamed(app, org.accessToken, ownOpportunity.id, ownOpportunity.pipelineId, "Closed Lost");
    const ownerNotifications = await listNotifications(app, org.accessToken);
    expect(ownerNotifications.body).toHaveLength(0);
  });

  it("notifies a quote's owner on public acceptance/rejection", async () => {
    const org = await registerOrg(app, "Notify Quotes Co", "nq");
    const account = await createAccount(app, org.accessToken, "Notify Quotes Account");

    const quote = await createSentQuote(app, org.accessToken, account.id);
    await request(app.getHttpServer()).post(`/api/v1/public/quotes/${quote.shareToken}/accept`).expect(201);

    const notifications = await listNotifications(app, org.accessToken);
    expect(notifications.body).toHaveLength(1);
    expect(notifications.body[0]).toMatchObject({ type: "quote.accepted", link: `/quotes/${quote.id}` });
  });

  it("supports unread-count, mark-read, and mark-all-read", async () => {
    const org = await registerOrg(app, "Notify Actions Co", "na");
    const account = await createAccount(app, org.accessToken, "Notify Actions Account");

    const quoteA = await createSentQuote(app, org.accessToken, account.id);
    await request(app.getHttpServer()).post(`/api/v1/public/quotes/${quoteA.shareToken}/accept`).expect(201);
    const quoteB = await createSentQuote(app, org.accessToken, account.id);
    await request(app.getHttpServer()).post(`/api/v1/public/quotes/${quoteB.shareToken}/reject`).expect(201);

    const unreadBefore = await request(app.getHttpServer()).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${org.accessToken}`).expect(200);
    expect(unreadBefore.body.count).toBe(2);

    const list = await listNotifications(app, org.accessToken);
    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${list.body[0].id}/read`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    const unreadAfterOne = await request(app.getHttpServer()).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${org.accessToken}`).expect(200);
    expect(unreadAfterOne.body.count).toBe(1);

    await request(app.getHttpServer()).post("/api/v1/notifications/read-all").set("Authorization", `Bearer ${org.accessToken}`).expect(204);
    const unreadAfterAll = await request(app.getHttpServer()).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${org.accessToken}`).expect(200);
    expect(unreadAfterAll.body.count).toBe(0);
  });

  it("isolates notifications per user and per organization, and 404s marking someone else's notification read", async () => {
    const orgA = await registerOrg(app, "Notify Iso A", "nia");
    const orgB = await registerOrg(app, "Notify Iso B", "nib");
    const secondA = await inviteSecondUser(app, orgA.accessToken, "nia-second");

    const accountA = await createAccount(app, orgA.accessToken, "Iso Account A");
    const ticket = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ subject: "Iso ticket", accountId: accountA.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket.body.id}/assign`)
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ assigneeId: secondA.id })
      .expect(201);

    const bNotifications = await listNotifications(app, orgB.accessToken);
    expect(bNotifications.body).toHaveLength(0);

    const secondANotifications = await listNotifications(app, secondA.accessToken);
    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${secondANotifications.body[0].id}/read`)
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .expect(404);
  });

  it("requires authentication", async () => {
    await request(app.getHttpServer()).get("/api/v1/notifications").expect(401);
    await request(app.getHttpServer()).get("/api/v1/notifications/unread-count").expect(401);
  });
});
