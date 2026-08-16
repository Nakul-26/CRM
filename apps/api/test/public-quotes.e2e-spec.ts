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

async function createSentQuote(app: INestApplication, token: string, accountId: string) {
  const created = await request(app.getHttpServer())
    .post("/api/v1/quotes")
    .set("Authorization", `Bearer ${token}`)
    .send({ accountId, lineItems: [{ name: "Widget", quantity: 3, unitPrice: 20 }] })
    .expect(201);
  const sent = await request(app.getHttpServer())
    .post(`/api/v1/quotes/${created.body.quote.id}/send`)
    .set("Authorization", `Bearer ${token}`)
    .expect(201);
  return sent.body.quote as { id: string; shareToken: string; accountId: string };
}

describe("Public quote acceptance (e2e, unauthenticated)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("is viewable by an unauthenticated request using only the share token", async () => {
    const org = await registerOrg(app, "Vandelay Public", "vp");
    const account = await createAccount(app, org.accessToken, "Vandelay Industries");
    const quote = await createSentQuote(app, org.accessToken, account.id);

    const view = await request(app.getHttpServer()).get(`/api/v1/public/quotes/${quote.shareToken}`).expect(200);
    expect(view.body.quote.status).toBe("sent");
    expect(view.body.accountName).toBe("Vandelay Industries");
    expect(view.body.organizationName).toBe("Vandelay Public");
    expect(view.body.version.lineItems).toHaveLength(1);
  });

  it("404s for an unknown or malformed token, without requiring auth", async () => {
    await request(app.getHttpServer()).get(`/api/v1/public/quotes/${crypto.randomUUID()}`).expect(404);
  });

  it("accepts a sent quote via the public link and publishes quote.accepted with the correct organizationId", async () => {
    const org = await registerOrg(app, "Kramerica Public", "kp");
    const account = await createAccount(app, org.accessToken, "Kramerica Industries");
    const quote = await createSentQuote(app, org.accessToken, account.id);

    const accepted = await request(app.getHttpServer()).post(`/api/v1/public/quotes/${quote.shareToken}/accept`).expect(201);
    expect(accepted.body.quote.status).toBe("accepted");
    expect(accepted.body.quote.acceptedAt).toBeTruthy();

    // Confirm the event landed correctly scoped to this org's account timeline
    // (published with an explicit organizationId — there's no JWT on this path).
    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.id}/timeline`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const types = timeline.body.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(["quote.created", "quote.sent", "quote.accepted"]));
  });

  it("rejects a sent quote via the public link", async () => {
    const org = await registerOrg(app, "Pendant Public", "pp");
    const account = await createAccount(app, org.accessToken, "Pendant Publishing");
    const quote = await createSentQuote(app, org.accessToken, account.id);

    const rejected = await request(app.getHttpServer()).post(`/api/v1/public/quotes/${quote.shareToken}/reject`).expect(201);
    expect(rejected.body.quote.status).toBe("rejected");
    expect(rejected.body.quote.rejectedAt).toBeTruthy();
  });

  it("serves a PDF for a sent quote via the public link, unauthenticated", async () => {
    const org = await registerOrg(app, "Soylent Public", "solp");
    const account = await createAccount(app, org.accessToken, "Soylent Corp");
    const quote = await createSentQuote(app, org.accessToken, account.id);

    const pdf = await request(app.getHttpServer()).get(`/api/v1/public/quotes/${quote.shareToken}/pdf`).expect(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(Buffer.byteLength(pdf.body)).toBeGreaterThan(500);
  });

  it("only allows accept/reject from status 'sent' — a draft's token doesn't exist yet, and accepted is terminal", async () => {
    const org = await registerOrg(app, "Bluth Public", "blp");
    const account = await createAccount(app, org.accessToken, "Bluth Company");
    const quote = await createSentQuote(app, org.accessToken, account.id);

    await request(app.getHttpServer()).post(`/api/v1/public/quotes/${quote.shareToken}/accept`).expect(201);
    // Already accepted — a second accept/reject must fail, not silently succeed.
    await request(app.getHttpServer()).post(`/api/v1/public/quotes/${quote.shareToken}/accept`).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/public/quotes/${quote.shareToken}/reject`).expect(400);
  });
});
