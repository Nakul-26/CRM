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

describe("CRM Accounts (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates, lists, updates, and soft-deletes an account", async () => {
    const org = await registerOrg(app, "Initrode", "ir");

    const created = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Acme Corporation", industry: "Manufacturing", tags: ["vip"] })
      .expect(201);
    expect(created.body.name).toBe("Acme Corporation");
    expect(created.body.tags).toEqual(["vip"]);

    const list = await request(app.getHttpServer())
      .get("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(list.body.map((a: { id: string }) => a.id)).toContain(created.body.id);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/accounts/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ industry: "Software" })
      .expect(200);
    expect(updated.body.industry).toBe("Software");

    await request(app.getHttpServer())
      .delete(`/api/v1/accounts/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    // Soft-deleted accounts no longer resolve through the normal API.
    await request(app.getHttpServer())
      .get(`/api/v1/accounts/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(404);

    const listAfterDelete = await request(app.getHttpServer())
      .get("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(listAfterDelete.body.map((a: { id: string }) => a.id)).not.toContain(created.body.id);
  });

  it("rejects an account owner id that belongs to another organization", async () => {
    const orgA = await registerOrg(app, "Umbrella CRM", "um2");
    const orgB = await registerOrg(app, "Hooli CRM", "ho2");

    await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ name: "Cross-tenant owner attempt", ownerId: orgA.user.id })
      .expect(404);
  });

  it("404s (not silently succeeds) when an org tries to read, update, or delete another org's account", async () => {
    const orgA = await registerOrg(app, "Wonka CRM", "wo");
    const orgB = await registerOrg(app, "Stark CRM", "st2");

    const account = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ name: "Org A's Account" })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/accounts/${account.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ industry: "Hacked" })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/accounts/${account.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);
  });

  it("enforces RBAC: a Member cannot delete an account", async () => {
    const org = await registerOrg(app, "Massive Dynamic CRM", "md");

    const roles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-crm"), fullName: "Mel Member", roleIds: [memberRole.id] })
      .expect(201);

    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);

    const account = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${memberLogin.body.tokens.accessToken}`)
      .send({ name: "Member-created account" })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/accounts/${account.body.id}`)
      .set("Authorization", `Bearer ${memberLogin.body.tokens.accessToken}`)
      .expect(403);
  });
});
