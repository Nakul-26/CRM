import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./setup/test-app";
import { assertNoMessage, clearMailpit, getMessage, waitForMessage } from "./setup/mailpit";

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

async function createContact(app: INestApplication, token: string, accountId: string, email: string) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/contacts")
    .set("Authorization", `Bearer ${token}`)
    .send({ accountId, firstName: "Jane", lastName: "Customer", email })
    .expect(201);
  return res.body.id as string;
}

describe("Mail dispatch triggers (e2e, real Mailpit)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("emails the contact when a ticket is created with a contact on file", async () => {
    await clearMailpit();
    const org = await registerOrg(app, "Initrode Mail", "im");
    const accountId = await createAccount(app, org.accessToken, "Initrode Account");
    const contactEmail = uniqueEmail("ticket-contact");
    const contactId = await createContact(app, org.accessToken, accountId, contactEmail);

    await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "Cannot access dashboard", accountId, contactId })
      .expect(201);

    const message = await waitForMessage((m) => m.To.some((addr) => addr.Address === contactEmail));
    expect(message.Subject).toContain("Cannot access dashboard");

    const full = await getMessage(message.ID);
    expect(full.Text).toContain("Cannot access dashboard");
  });

  it("does not attempt to email when a ticket has no contact", async () => {
    await clearMailpit();
    const org = await registerOrg(app, "Massive Dynamic Mail", "mdm");
    const accountId = await createAccount(app, org.accessToken, "Massive Dynamic Account");

    const created = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "No contact ticket", accountId })
      .expect(201);
    expect(created.body.contactId).toBeNull();

    await assertNoMessage(() => true);
  });

  it("emails the contact on a public comment, but never on an internal note", async () => {
    await clearMailpit();
    const org = await registerOrg(app, "Umbrella Corp Mail", "ucm");
    const accountId = await createAccount(app, org.accessToken, "Umbrella Account");
    const contactEmail = uniqueEmail("comment-contact");
    const contactId = await createContact(app, org.accessToken, accountId, contactEmail);

    const ticket = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "Billing discrepancy", accountId, contactId })
      .expect(201);

    // The ticket.created confirmation email already landed — clear it so we
    // isolate the comment-triggered email below.
    await waitForMessage((m) => m.To.some((addr) => addr.Address === contactEmail));
    await clearMailpit();

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket.body.id}/comments`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ body: "This is an internal-only note", isPublic: false })
      .expect(201);
    await assertNoMessage((m) => m.To.some((addr) => addr.Address === contactEmail));

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${ticket.body.id}/comments`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ body: "We've refunded the extra charge", isPublic: true })
      .expect(201);

    const message = await waitForMessage((m) => m.To.some((addr) => addr.Address === contactEmail));
    const full = await getMessage(message.ID);
    expect(full.Text).toContain("We've refunded the extra charge");
  });

  it("emails the contact the public link when a quote with a contact is sent", async () => {
    await clearMailpit();
    const org = await registerOrg(app, "Wayne Enterprises Mail", "wem");
    const accountId = await createAccount(app, org.accessToken, "Wayne Account");
    const contactEmail = uniqueEmail("quote-contact");
    const contactId = await createContact(app, org.accessToken, accountId, contactEmail);

    const quote = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId, contactId, lineItems: [{ name: "Consulting", quantity: 1, unitPrice: 2500 }] })
      .expect(201);

    const sent = await request(app.getHttpServer())
      .post(`/api/v1/quotes/${quote.body.quote.id}/send`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);
    const shareToken = sent.body.quote.shareToken as string;

    const message = await waitForMessage((m) => m.To.some((addr) => addr.Address === contactEmail));
    const full = await getMessage(message.ID);
    expect(full.Text).toContain(shareToken);
  });

  it("does not attempt to email when a sent quote has no contact", async () => {
    await clearMailpit();
    const org = await registerOrg(app, "Stark Industries Mail", "sim");
    const accountId = await createAccount(app, org.accessToken, "Stark Account");

    const quote = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId, lineItems: [{ name: "Consulting", quantity: 1, unitPrice: 2500 }] })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/quotes/${quote.body.quote.id}/send`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);

    await assertNoMessage(() => true);
  });
});
