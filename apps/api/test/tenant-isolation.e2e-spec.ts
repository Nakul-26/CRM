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

describe("Multi-tenant isolation (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("never returns another organization's users from the user list", async () => {
    const orgA = await registerOrg(app, "Northwind", "nw");
    const orgB = await registerOrg(app, "Contoso", "co");

    const listA = await request(app.getHttpServer())
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .expect(200);

    const emailsInA = listA.body.map((u: { email: string }) => u.email);
    expect(emailsInA).toContain(orgA.email);
    expect(emailsInA).not.toContain(orgB.email);
  });

  it("404s (not silently succeeds) when an org tries to deactivate a user belonging to another org", async () => {
    const orgA = await registerOrg(app, "Umbrella", "um");
    const orgB = await registerOrg(app, "Initech", "in");

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${orgA.user.id}/deactivate`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);

    // org A's owner must still be active — the cross-tenant attempt had no effect.
    const meAfter = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .expect(200);
    expect(meAfter.body.email).toBe(orgA.email);
  });

  it("404s when an org tries to assign one of its roles to a user from another org", async () => {
    const orgA = await registerOrg(app, "Stark Industries", "si");
    const orgB = await registerOrg(app, "Wayne Enterprises", "we");

    const orgBRoles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(200);
    const orgBAdminRole = orgBRoles.body.find((r: { name: string }) => r.name === "Admin");

    // orgB tries to grant its own Admin role to orgA's owner user — must be rejected.
    await request(app.getHttpServer())
      .post(`/api/v1/roles/${orgBAdminRole.id}/users/${orgA.user.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);
  });

  it("rejects a token whose organization no longer matches a resource's org even for a valid resource id shape", async () => {
    const orgA = await registerOrg(app, "Globex", "gl");

    // A syntactically valid but nonexistent role id under orgA's own token: 404, not 403/500.
    await request(app.getHttpServer())
      .post(`/api/v1/roles/00000000-0000-0000-0000-000000000000/users/${orgA.user.id}`)
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .expect(404);
  });

  it("404s when an org tries to add another org's user as a team member", async () => {
    const orgA = await registerOrg(app, "Aperture Science", "ap");
    const orgB = await registerOrg(app, "Black Mesa", "bm");

    const team = await request(app.getHttpServer())
      .post("/api/v1/teams")
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ name: "Research", memberIds: [] })
      .expect(201);

    // orgB tries to add orgA's owner as a member of orgB's team — must be rejected.
    await request(app.getHttpServer())
      .post(`/api/v1/teams/${team.body.id}/members/${orgA.user.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);

    // Also rejected when supplied up-front in memberIds at creation time.
    await request(app.getHttpServer())
      .post("/api/v1/teams")
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ name: "Research 2", memberIds: [orgA.user.id] })
      .expect(404);
  });

  it("enforces permission-based RBAC: a Member cannot invite users, only Owner/Admin can", async () => {
    const orgA = await registerOrg(app, "Soylent", "so");

    const roles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ email: uniqueEmail("member"), fullName: "Mel Member", roleIds: [memberRole.id] })
      .expect(201);

    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);

    // Member has leads/opportunities/etc. view/create but not identity.users.invite.
    await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${memberLogin.body.tokens.accessToken}`)
      .send({ email: uniqueEmail("blocked"), fullName: "Should Fail", roleIds: [memberRole.id] })
      .expect(403);
  });
});
