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
  return res.body.id as string;
}

async function createTicket(app: INestApplication, token: string, accountId: string, subject: string) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/tickets")
    .set("Authorization", `Bearer ${token}`)
    .send({ subject, accountId })
    .expect(201);
  return res.body as { id: string };
}

describe("Ticket comments (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("stamps firstRespondedAt on the first public comment, and never again", async () => {
    const org = await registerOrg(app, "Initrode Comments", "ic");
    const accountId = await createAccount(app, org.accessToken, "Initrode Account");
    const ticket = await createTicket(app, org.accessToken, accountId, "Need help");

    const before = await request(app.getHttpServer())
      .get(`/api/v1/tickets/${ticket.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(before.body.firstRespondedAt).toBeNull();

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ body: "First public reply", isPublic: true })
      .expect(201);

    const afterFirst = await request(app.getHttpServer())
      .get(`/api/v1/tickets/${ticket.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(afterFirst.body.firstRespondedAt).not.toBeNull();
    const firstStamp = afterFirst.body.firstRespondedAt;

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ body: "Second public reply", isPublic: true })
      .expect(201);

    const afterSecond = await request(app.getHttpServer())
      .get(`/api/v1/tickets/${ticket.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(afterSecond.body.firstRespondedAt).toBe(firstStamp);
  });

  it("never stamps firstRespondedAt for internal (non-public) comments", async () => {
    const org = await registerOrg(app, "Massive Dynamic Comments", "mdc");
    const accountId = await createAccount(app, org.accessToken, "Massive Dynamic Account");
    const ticket = await createTicket(app, org.accessToken, accountId, "Internal note test");

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ body: "Internal note only", isPublic: false })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/tickets/${ticket.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(after.body.firstRespondedAt).toBeNull();
  });

  it("round-trips isPublic and lists comments in creation order", async () => {
    const org = await registerOrg(app, "Umbrella Corp Comments", "ucc");
    const accountId = await createAccount(app, org.accessToken, "Umbrella Account");
    const ticket = await createTicket(app, org.accessToken, accountId, "Multi-comment ticket");

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ body: "Internal triage note", isPublic: false })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket.id}/comments`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ body: "Customer-visible update" })
      .expect(201); // isPublic defaults to true when omitted

    const list = await request(app.getHttpServer())
      .get(`/api/v1/tickets/${ticket.id}/comments`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[0].body).toBe("Internal triage note");
    expect(list.body[0].isPublic).toBe(false);
    expect(list.body[1].body).toBe("Customer-visible update");
    expect(list.body[1].isPublic).toBe(true);
  });
});
