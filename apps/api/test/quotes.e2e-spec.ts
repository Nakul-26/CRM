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

const TWO_LINE_ITEMS = [
  { name: "Consulting", quantity: 2, unitPrice: 100, discountPercent: 10, taxPercent: 5 },
  { name: "Support Plan", quantity: 1, unitPrice: 50, taxPercent: 10 },
];

describe("Quotes — core CRUD, versioning, status transitions (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a quote, computing totals from line items (discount + tax math)", async () => {
    const org = await registerOrg(app, "Wonka Quotes", "wq");
    const account = await createAccount(app, org.accessToken, "Wonka Industries");

    const created = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, lineItems: TWO_LINE_ITEMS })
      .expect(201);

    expect(created.body.quote.status).toBe("draft");
    expect(created.body.quote.quoteNumber).toMatch(/^Q-\d{5}$/);
    expect(created.body.quote.subtotal).toBe(250);
    expect(created.body.quote.discountTotal).toBe(20);
    expect(created.body.quote.taxTotal).toBe(14);
    expect(created.body.quote.total).toBe(244);
    expect(created.body.version.versionNumber).toBe(1);
    expect(created.body.version.lineItems).toHaveLength(2);
    expect(created.body.version.lineItems[0].lineTotal).toBe(189);
  });

  it("lists quotes and reads one back with its current version", async () => {
    const org = await registerOrg(app, "Acme Quotes", "aq");
    const account = await createAccount(app, org.accessToken, "Acme Corp");

    const created = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, lineItems: [{ name: "Widget", quantity: 1, unitPrice: 10 }] })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(list.body.map((q: { id: string }) => q.id)).toContain(created.body.quote.id);

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/quotes/${created.body.quote.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(fetched.body.quote.id).toBe(created.body.quote.id);
    expect(fetched.body.version.lineItems).toHaveLength(1);
  });

  it("PATCH while draft replaces line items in place (no new version) and recomputes totals", async () => {
    const org = await registerOrg(app, "Stark Quotes", "stq");
    const account = await createAccount(app, org.accessToken, "Stark Industries");

    const created = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, lineItems: [{ name: "Arc Reactor", quantity: 1, unitPrice: 1000 }] })
      .expect(201);
    expect(created.body.quote.total).toBe(1000);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/quotes/${created.body.quote.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ lineItems: [{ name: "Arc Reactor Mk II", quantity: 2, unitPrice: 1200 }], notes: "revised pricing" })
      .expect(200);
    expect(updated.body.quote.currentVersion).toBe(1); // still version 1 — draft edits mutate in place
    expect(updated.body.quote.total).toBe(2400);
    expect(updated.body.version.lineItems).toHaveLength(1);
    expect(updated.body.version.lineItems[0].name).toBe("Arc Reactor Mk II");
    expect(updated.body.quote.notes).toBe("revised pricing");

    const versions = await request(app.getHttpServer())
      .get(`/api/v1/quotes/${created.body.quote.id}/versions`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(versions.body).toHaveLength(1);
  });

  it("soft-deletes a draft quote but blocks delete once sent", async () => {
    const org = await registerOrg(app, "Gringotts Quotes", "gq");
    const account = await createAccount(app, org.accessToken, "Gringotts Bank");

    const draft = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, lineItems: [{ name: "Vault Fee", quantity: 1, unitPrice: 500 }] })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/quotes/${draft.body.quote.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    const sentSetup = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, lineItems: [{ name: "Another Vault Fee", quantity: 1, unitPrice: 500 }] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/quotes/${sentSetup.body.quote.id}/send`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/quotes/${sentSetup.body.quote.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(400);
  });

  it("404s when an org tries to read another org's quote, and rejects an account from a different org", async () => {
    const orgA = await registerOrg(app, "Kramerica Quotes", "kq");
    const orgB = await registerOrg(app, "Pendant Quotes", "pq");
    const accountA = await createAccount(app, orgA.accessToken, "Kramerica Industries");

    const quote = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ accountId: accountA.id, lineItems: [{ name: "Item", quantity: 1, unitPrice: 1 }] })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/quotes/${quote.body.quote.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ accountId: accountA.id, lineItems: [{ name: "Item", quantity: 1, unitPrice: 1 }] })
      .expect(404);
  });

  it("send generates a share token and locks the quote against direct edits", async () => {
    const org = await registerOrg(app, "Bluth Quotes", "bq");
    const account = await createAccount(app, org.accessToken, "Bluth Company");

    const created = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, lineItems: [{ name: "Banana Stand", quantity: 1, unitPrice: 100 }] })
      .expect(201);

    const sent = await request(app.getHttpServer())
      .post(`/api/v1/quotes/${created.body.quote.id}/send`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);
    expect(sent.body.quote.status).toBe("sent");
    expect(sent.body.quote.shareToken).toBeTruthy();
    expect(sent.body.quote.sentAt).toBeTruthy();

    await request(app.getHttpServer())
      .patch(`/api/v1/quotes/${created.body.quote.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ notes: "should not be allowed" })
      .expect(400);

    // Re-sending an already-sent quote is not a valid transition.
    await request(app.getHttpServer())
      .post(`/api/v1/quotes/${created.body.quote.id}/send`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(400);
  });

  it("revise clones the latest version into v2 and reopens the quote as draft, preserving v1 history", async () => {
    const org = await registerOrg(app, "Dunder Mifflin Quotes", "dmq");
    const account = await createAccount(app, org.accessToken, "Dunder Mifflin");

    const created = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, lineItems: [{ name: "Paper (case)", quantity: 10, unitPrice: 25 }] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/quotes/${created.body.quote.id}/send`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);

    const revised = await request(app.getHttpServer())
      .post(`/api/v1/quotes/${created.body.quote.id}/revise`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);
    expect(revised.body.quote.status).toBe("draft");
    expect(revised.body.quote.currentVersion).toBe(2);

    const versions = await request(app.getHttpServer())
      .get(`/api/v1/quotes/${created.body.quote.id}/versions`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(versions.body).toHaveLength(2);
    expect(versions.body[0].versionNumber).toBe(1);
    expect(versions.body[0].lineItems[0].name).toBe("Paper (case)");
    expect(versions.body[1].versionNumber).toBe(2);

    // Now that it's draft again, it can be re-sent.
    const resent = await request(app.getHttpServer())
      .post(`/api/v1/quotes/${created.body.quote.id}/send`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);
    expect(resent.body.quote.status).toBe("sent");
  });

  it("lazily expires a sent quote past its validUntil date on next access", async () => {
    const org = await registerOrg(app, "Los Pollos Quotes", "lpq");
    const account = await createAccount(app, org.accessToken, "Los Pollos Hermanos");

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const created = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, validUntil: yesterday, lineItems: [{ name: "Chicken", quantity: 1, unitPrice: 10 }] })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/quotes/${created.body.quote.id}/send`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/quotes/${created.body.quote.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(fetched.body.quote.status).toBe("expired");

    // Terminal in the sense that a plain re-send is blocked; /revise is the way back to draft.
    await request(app.getHttpServer())
      .post(`/api/v1/quotes/${created.body.quote.id}/send`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(400);
  });

  it("manages quote templates and prefills line items from a template on create", async () => {
    const org = await registerOrg(app, "Prestige Quotes", "prq");
    const account = await createAccount(app, org.accessToken, "Prestige Worldwide");

    const template = await request(app.getHttpServer())
      .post("/api/v1/quotes/templates")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({
        name: "Standard Package",
        termsText: "Net 30",
        defaultNotes: "Thanks for your business",
        defaultLineItems: [{ name: "Package A", quantity: 1, unitPrice: 300 }],
      })
      .expect(201);

    const quote = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, templateId: template.body.id })
      .expect(201);
    expect(quote.body.version.lineItems).toHaveLength(1);
    expect(quote.body.version.lineItems[0].name).toBe("Package A");
    expect(quote.body.quote.notes).toBe("Thanks for your business");

    const templates = await request(app.getHttpServer())
      .get("/api/v1/quotes/templates")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(templates.body.map((t: { id: string }) => t.id)).toContain(template.body.id);
  });

  it("downloads a PDF for a quote and for a specific historical version", async () => {
    const org = await registerOrg(app, "Cyberdyne Quotes", "cq");
    const account = await createAccount(app, org.accessToken, "Cyberdyne Systems");

    const created = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, lineItems: [{ name: "T-800 Unit", quantity: 1, unitPrice: 5000 }] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/quotes/${created.body.quote.id}/send`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/quotes/${created.body.quote.id}/revise`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);

    const currentPdf = await request(app.getHttpServer())
      .get(`/api/v1/quotes/${created.body.quote.id}/pdf`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(currentPdf.headers["content-type"]).toBe("application/pdf");
    expect(Buffer.byteLength(currentPdf.body)).toBeGreaterThan(500);

    const v1Pdf = await request(app.getHttpServer())
      .get(`/api/v1/quotes/${created.body.quote.id}/versions/1/pdf`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(v1Pdf.headers["content-type"]).toBe("application/pdf");
    expect(Buffer.byteLength(v1Pdf.body)).toBeGreaterThan(500);
  });

  it("enforces RBAC: a Member can create/edit quotes but cannot delete them or manage templates", async () => {
    const org = await registerOrg(app, "Hooli Quotes", "hq");
    const account = await createAccount(app, org.accessToken, "Hooli");

    const roles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-quotes"), fullName: "Gavin Member", roleIds: [memberRole.id] })
      .expect(201);

    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);
    const memberToken = memberLogin.body.tokens.accessToken as string;

    const quote = await request(app.getHttpServer())
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ accountId: account.id, lineItems: [{ name: "Item", quantity: 1, unitPrice: 1 }] })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/quotes/${quote.body.quote.id}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ notes: "member note" })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/quotes/${quote.body.quote.id}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post("/api/v1/quotes/templates")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Blocked template" })
      .expect(403);
  });
});
