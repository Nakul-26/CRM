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

async function createAccount(app: INestApplication, accessToken: string, name: string) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/accounts")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name })
    .expect(201);
  return res.body;
}

describe("CRM Contacts (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a contact linked to an account, lists it filtered by account, updates and soft-deletes it", async () => {
    const org = await registerOrg(app, "Pied Piper CRM", "pp");
    const account = await createAccount(app, org.accessToken, "Hooli");

    const created = await request(app.getHttpServer())
      .post("/api/v1/contacts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, firstName: "Gavin", lastName: "Belson", email: "gavin@hooli.example" })
      .expect(201);
    expect(created.body.firstName).toBe("Gavin");
    expect(created.body.accountId).toBe(account.id);

    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/contacts?accountId=${account.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(filtered.body.map((c: { id: string }) => c.id)).toContain(created.body.id);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/contacts/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ jobTitle: "CEO" })
      .expect(200);
    expect(updated.body.jobTitle).toBe("CEO");

    await request(app.getHttpServer())
      .delete(`/api/v1/contacts/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/contacts/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(404);
  });

  it("allows a contact with no account (nullable accountId)", async () => {
    const org = await registerOrg(app, "Raviga CRM", "rv");

    const created = await request(app.getHttpServer())
      .post("/api/v1/contacts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ firstName: "Peter", lastName: "Gregory" })
      .expect(201);
    expect(created.body.accountId).toBeNull();
  });

  it("rejects a cross-org accountId on create and on update", async () => {
    const orgA = await registerOrg(app, "Aviato CRM", "av");
    const orgB = await registerOrg(app, "Bream Hall CRM", "bh");
    const orgAAccount = await createAccount(app, orgA.accessToken, "Org A's account");

    await request(app.getHttpServer())
      .post("/api/v1/contacts")
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ accountId: orgAAccount.id, firstName: "Erlich", lastName: "Bachman" })
      .expect(404);

    const orgBContact = await request(app.getHttpServer())
      .post("/api/v1/contacts")
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ firstName: "Nelson", lastName: "Bighetti" })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/contacts/${orgBContact.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ accountId: orgAAccount.id })
      .expect(404);
  });

  it("404s when an org tries to read, update, or delete another org's contact", async () => {
    const orgA = await registerOrg(app, "Endframe CRM", "ef");
    const orgB = await registerOrg(app, "Optimoji CRM", "op");

    const contact = await request(app.getHttpServer())
      .post("/api/v1/contacts")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ firstName: "Jared", lastName: "Dunn" })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/contacts/${contact.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/contacts/${contact.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ jobTitle: "Hacked" })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/contacts/${contact.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);
  });

  it("enforces RBAC: a Member cannot delete a contact", async () => {
    const org = await registerOrg(app, "Bachmanity CRM", "bm2");

    const roles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-contact"), fullName: "Mel Member", roleIds: [memberRole.id] })
      .expect(201);

    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);

    const contact = await request(app.getHttpServer())
      .post("/api/v1/contacts")
      .set("Authorization", `Bearer ${memberLogin.body.tokens.accessToken}`)
      .send({ firstName: "Denpok", lastName: "Member-made" })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/contacts/${contact.body.id}`)
      .set("Authorization", `Bearer ${memberLogin.body.tokens.accessToken}`)
      .expect(403);
  });
});
