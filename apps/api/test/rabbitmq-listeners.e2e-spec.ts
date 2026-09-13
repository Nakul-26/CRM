// Must run before any other import — test-app.ts reads these via `??=`, so
// setting them here (before it's imported, even transitively) is what makes
// this one spec file exercise the real RabbitMQ-backed Mail/Notifications/
// QuoteAccepted consumers (Phase 22) while every other spec file keeps using
// the default in-process transport. Same pattern as rabbitmq-audit.e2e-spec.ts.
process.env.EVENT_BUS_TRANSPORT = "rabbitmq";
process.env.RABBITMQ_URL ??= "amqp://guest:guest@localhost:5673";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./setup/test-app";
import { clearMailpit, waitForMessage } from "./setup/mailpit";

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

async function createContact(app: INestApplication, token: string, accountId: string, email: string) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/contacts")
    .set("Authorization", `Bearer ${token}`)
    .send({ accountId, firstName: "Jane", lastName: "Customer", email })
    .expect(201);
  return res.body.id as string;
}

async function createOpportunity(app: INestApplication, token: string, accountId: string, name: string) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/opportunities")
    .set("Authorization", `Bearer ${token}`)
    .send({ name, accountId, value: 10000 })
    .expect(201);
  return res.body as { id: string; pipelineId: string };
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

/**
 * Delivery for all three listeners under this spec is now via a real broker
 * round-trip (publish → queue → consumer), not a same-tick in-process emit —
 * so, unlike the default-transport specs for these same listeners, every
 * assertion here must poll rather than assume immediate consistency.
 */
async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 10000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for a condition over RabbitMQ`);
}

describe("Mail/Notifications/QuoteAccepted over RabbitMQ (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("delivers a ticket-created email through the broker instead of the in-process handler", async () => {
    await clearMailpit();
    const org = await registerOrg(app, "RabbitMQ Mail Co", "rmqmail");
    const account = await createAccount(app, org.accessToken, "Broker Mail Account");
    const contactEmail = uniqueEmail("rmqmail-contact");
    const contactId = await createContact(app, org.accessToken, account.id, contactEmail);

    await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "Broker delivery test", accountId: account.id, contactId })
      .expect(201);

    const message = await waitForMessage((m) => m.To.some((to) => to.Address === contactEmail), 10000);
    expect(message.Subject).toContain("Broker delivery test");
  });

  it("creates a ticket-assignment notification through the broker instead of the in-process handler", async () => {
    const org = await registerOrg(app, "RabbitMQ Notify Co", "rmqnotify");
    const second = await inviteSecondUser(app, org.accessToken, "rmqnotify-second");
    const account = await createAccount(app, org.accessToken, "Broker Notify Account");

    const ticket = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "Broker notification test", accountId: account.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket.body.id}/assign`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ assigneeId: second.id })
      .expect(201);

    const notification = await waitFor(async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/notifications").set("Authorization", `Bearer ${second.accessToken}`).expect(200);
      return res.body.find((n: { type: string; link: string }) => n.type === "ticket.assigned" && n.link === `/support/tickets/${ticket.body.id}`);
    });
    expect(notification).toBeDefined();
  });

  it("auto-advances a linked Opportunity through the broker instead of the in-process handler", async () => {
    const org = await registerOrg(app, "RabbitMQ Automation Co", "rmqauto");
    const account = await createAccount(app, org.accessToken, "Broker Automation Account");
    const opportunity = await createOpportunity(app, org.accessToken, account.id, "Broker-Delivered Deal");
    const quote = await createSentQuote(app, org.accessToken, account.id, opportunity.id);

    await request(app.getHttpServer()).post(`/api/v1/public/quotes/${quote.shareToken}/accept`).expect(201);

    const updated = await waitFor(async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/opportunities/${opportunity.id}`).set("Authorization", `Bearer ${org.accessToken}`).expect(200);
      return res.body.outcome === "won" ? res.body : undefined;
    });
    expect(updated.outcome).toBe("won");
    expect(updated.closedAt).not.toBeNull();
  });
});
