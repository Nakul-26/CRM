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

describe("SLA Policies (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates, lists, updates, and soft-deletes an SLA policy", async () => {
    const org = await registerOrg(app, "Initrode Support", "is");

    const created = await request(app.getHttpServer())
      .post("/api/v1/sla-policies")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Urgent SLA", priority: "urgent", firstResponseTargetMinutes: 30, resolutionTargetMinutes: 240 })
      .expect(201);
    expect(created.body.priority).toBe("urgent");
    expect(created.body.firstResponseTargetMinutes).toBe(30);

    const list = await request(app.getHttpServer())
      .get("/api/v1/sla-policies")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(list.body.map((p: { id: string }) => p.id)).toContain(created.body.id);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/sla-policies/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ resolutionTargetMinutes: 180 })
      .expect(200);
    expect(updated.body.resolutionTargetMinutes).toBe(180);

    await request(app.getHttpServer())
      .delete(`/api/v1/sla-policies/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/sla-policies/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(404);
  });

  it("enforces one policy per priority per org, and allows re-adding after a delete", async () => {
    const org = await registerOrg(app, "Massive Dynamic Support", "mds");

    const first = await request(app.getHttpServer())
      .post("/api/v1/sla-policies")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "High SLA", priority: "high", firstResponseTargetMinutes: 60, resolutionTargetMinutes: 480 })
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/v1/sla-policies")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Duplicate High SLA", priority: "high", firstResponseTargetMinutes: 45, resolutionTargetMinutes: 360 })
      .expect(409);

    await request(app.getHttpServer())
      .delete(`/api/v1/sla-policies/${first.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    // Re-adding a policy for the same priority after the old one was soft-deleted must succeed.
    await request(app.getHttpServer())
      .post("/api/v1/sla-policies")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "New High SLA", priority: "high", firstResponseTargetMinutes: 45, resolutionTargetMinutes: 360 })
      .expect(201);
  });

  it("404s when an org tries to read another org's SLA policy", async () => {
    const orgA = await registerOrg(app, "Umbrella Corp Support", "ucs");
    const orgB = await registerOrg(app, "Wayne Enterprises Support", "wes");

    const policy = await request(app.getHttpServer())
      .post("/api/v1/sla-policies")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ name: "Org A SLA", priority: "low", firstResponseTargetMinutes: 120, resolutionTargetMinutes: 1440 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/sla-policies/${policy.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);
  });

  it("enforces RBAC: SLA policies are Owner/Admin-only, even to view", async () => {
    const org = await registerOrg(app, "Stark Industries Support", "sis");

    const roles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-sla"), fullName: "Pepper Member", roleIds: [memberRole.id] })
      .expect(201);

    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);
    const memberToken = memberLogin.body.tokens.accessToken as string;

    await request(app.getHttpServer())
      .get("/api/v1/sla-policies")
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post("/api/v1/sla-policies")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Member SLA", priority: "medium", firstResponseTargetMinutes: 60, resolutionTargetMinutes: 480 })
      .expect(403);
  });
});
