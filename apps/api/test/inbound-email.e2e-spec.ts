import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createTestApp } from "./setup/test-app";
import { DATABASE_CONNECTION, type Database } from "../src/database/database.module";
import { tickets } from "../src/database/schema";

const WEBHOOK_SECRET = process.env.INBOUND_EMAIL_WEBHOOK_SECRET as string;

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

// externalMessageId is uniquely constrained across the whole table (a real
// Message-ID is globally unique per RFC 5322), and this test DB persists
// across separate test runs — a hardcoded literal here would collide with
// a row a previous run already inserted and get treated as a real
// duplicate delivery, exactly like re-sending the same production email.
function uniqueMessageId(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

async function getReplyToken(app: INestApplication, ticketId: string): Promise<string> {
  const db = app.get<Database>(DATABASE_CONNECTION);
  const [row] = await db.select({ replyToken: tickets.replyToken }).from(tickets).where(eq(tickets.id, ticketId));
  return row.replyToken;
}

describe("Inbound email-to-ticket webhook (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects a request with no secret header", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/support/inbound-email")
      .send({ to: "ticket+whatever@inbound.test", from: "customer@example.com", text: "Hi" })
      .expect(401);
  });

  it("rejects a request with the wrong secret", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/support/inbound-email")
      .set("x-inbound-email-secret", "wrong-secret")
      .send({ to: "ticket+whatever@inbound.test", from: "customer@example.com", text: "Hi" })
      .expect(401);
  });

  it("turns a correctly-addressed reply into a public, customer-sourced comment", async () => {
    const org = await registerOrg(app, "Initrode Inbound", "ii");
    const accountId = await createAccount(app, org.accessToken, "Initrode Account");
    const ticket = await createTicket(app, org.accessToken, accountId, "Need help");
    const replyToken = await getReplyToken(app, ticket.id);

    await request(app.getHttpServer())
      .post("/api/v1/support/inbound-email")
      .set("x-inbound-email-secret", WEBHOOK_SECRET)
      .send({
        to: `Support <ticket+${replyToken}@inbound.test>`,
        from: "customer@example.com",
        subject: "Re: Need help",
        text: "Thanks, here's more detail.",
        messageId: uniqueMessageId("msg"),
      })
      .expect(200, { received: true });

    const comments = await request(app.getHttpServer())
      .get(`/api/v1/tickets/${ticket.id}/comments`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(comments.body).toHaveLength(1);
    expect(comments.body[0]).toMatchObject({
      body: "Thanks, here's more detail.",
      isPublic: true,
      source: "inbound_email",
      authorId: null,
    });

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/tickets/${ticket.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(fetched.body.firstRespondedAt).toBeNull();
  });

  it("reopens a resolved ticket when a customer replies by email", async () => {
    const org = await registerOrg(app, "Massive Dynamic Inbound", "mdi");
    const accountId = await createAccount(app, org.accessToken, "Massive Dynamic Account");
    const ticket = await createTicket(app, org.accessToken, accountId, "Resolved then reopened");
    const replyToken = await getReplyToken(app, ticket.id);

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket.id}/status`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ status: "resolved" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/v1/support/inbound-email")
      .set("x-inbound-email-secret", WEBHOOK_SECRET)
      .send({ to: `ticket+${replyToken}@inbound.test`, from: "customer@example.com", text: "Still broken!", messageId: uniqueMessageId("msg") })
      .expect(200);

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/tickets/${ticket.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(fetched.body.status).toBe("open");
  });

  it("is idempotent on a redelivered messageId", async () => {
    const org = await registerOrg(app, "Umbrella Corp Inbound", "uci");
    const accountId = await createAccount(app, org.accessToken, "Umbrella Account");
    const ticket = await createTicket(app, org.accessToken, accountId, "Duplicate delivery test");
    const replyToken = await getReplyToken(app, ticket.id);

    const payload = { to: `ticket+${replyToken}@inbound.test`, from: "customer@example.com", text: "Same message twice", messageId: uniqueMessageId("msg-dup") };
    await request(app.getHttpServer()).post("/api/v1/support/inbound-email").set("x-inbound-email-secret", WEBHOOK_SECRET).send(payload).expect(200);
    await request(app.getHttpServer()).post("/api/v1/support/inbound-email").set("x-inbound-email-secret", WEBHOOK_SECRET).send(payload).expect(200);

    const comments = await request(app.getHttpServer())
      .get(`/api/v1/tickets/${ticket.id}/comments`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(comments.body).toHaveLength(1);
  });

  it("acks but discards a reply addressed to an unknown token", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/support/inbound-email")
      .set("x-inbound-email-secret", WEBHOOK_SECRET)
      .send({ to: "ticket+00000000-0000-0000-0000-000000000000@inbound.test", from: "customer@example.com", text: "Hello?" })
      .expect(200, { received: true });
  });

  it("strips HTML tags when only an html body is provided", async () => {
    const org = await registerOrg(app, "Wayne Enterprises Inbound", "wei");
    const accountId = await createAccount(app, org.accessToken, "Wayne Account");
    const ticket = await createTicket(app, org.accessToken, accountId, "HTML reply test");
    const replyToken = await getReplyToken(app, ticket.id);

    await request(app.getHttpServer())
      .post("/api/v1/support/inbound-email")
      .set("x-inbound-email-secret", WEBHOOK_SECRET)
      .send({ to: `ticket+${replyToken}@inbound.test`, from: "customer@example.com", html: "<p>Hello <b>there</b></p>", messageId: uniqueMessageId("msg-html") })
      .expect(200);

    const comments = await request(app.getHttpServer())
      .get(`/api/v1/tickets/${ticket.id}/comments`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(comments.body[0].body).toBe("Hello there");
  });
});
