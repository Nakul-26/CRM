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

describe("Leads (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates, lists, updates, and soft-deletes a lead", async () => {
    const org = await registerOrg(app, "Initech Leads", "il");

    const created = await request(app.getHttpServer())
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Peter Gibbons", company: "Initech", source: "website", email: "peter@initech.com" })
      .expect(201);
    expect(created.body.name).toBe("Peter Gibbons");
    expect(created.body.status).toBe("New");

    const list = await request(app.getHttpServer())
      .get("/api/v1/leads")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(list.body.map((l: { id: string }) => l.id)).toContain(created.body.id);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/leads/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ industry: "Software" })
      .expect(200);
    expect(updated.body.industry).toBe("Software");
    expect(updated.body.status).toBe("New"); // status is not part of the update surface

    await request(app.getHttpServer())
      .delete(`/api/v1/leads/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/leads/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(404);
  });

  it("404s when an org tries to read, update, or delete another org's lead", async () => {
    const orgA = await registerOrg(app, "Vandelay Leads", "va");
    const orgB = await registerOrg(app, "Kramerica Leads", "kr");

    const lead = await request(app.getHttpServer())
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ name: "Org A's Lead", source: "referral" })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/leads/${lead.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/leads/${lead.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ industry: "Hacked" })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/leads/${lead.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);
  });

  it("computes score from active scoring rules and recomputes on demand", async () => {
    const org = await registerOrg(app, "Score Corp", "sc");

    await request(app.getHttpServer())
      .post("/api/v1/leads/scoring-rules")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Business email", field: "email", operator: "isBusinessEmail", points: 10 })
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/v1/leads/scoring-rules")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "High value", field: "estimatedValue", operator: "greaterThan", value: 50000, points: 30 })
      .expect(201);
    const inactive = await request(app.getHttpServer())
      .post("/api/v1/leads/scoring-rules")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Ignored", field: "source", operator: "equals", value: "website", points: 100, active: false })
      .expect(201);
    expect(inactive.body.active).toBe(false);

    const lead = await request(app.getHttpServer())
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Big Fish", source: "website", email: "big@acme.com", estimatedValue: 100000 })
      .expect(201);
    expect(lead.body.score).toBe(40); // business email (10) + high value (30), inactive rule excluded

    await request(app.getHttpServer())
      .post("/api/v1/leads/scoring-rules")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Bonus", field: "source", operator: "equals", value: "website", points: 5 })
      .expect(201);

    // A new rule doesn't retroactively rescore...
    const unchanged = await request(app.getHttpServer())
      .get(`/api/v1/leads/${lead.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(unchanged.body.score).toBe(40);

    // ...until explicitly recalculated.
    const recalculated = await request(app.getHttpServer())
      .post(`/api/v1/leads/${lead.body.id}/recalculate-score`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);
    expect(recalculated.body.score).toBe(45);
  });

  it("enforces RBAC: a Member can edit leads but cannot delete them or manage scoring rules", async () => {
    const org = await registerOrg(app, "Massive Dynamic Leads", "mdl");

    const roles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-leads"), fullName: "Mel Member", roleIds: [memberRole.id] })
      .expect(201);

    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);
    const memberToken = memberLogin.body.tokens.accessToken as string;

    const lead = await request(app.getHttpServer())
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Member-created lead", source: "event" })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/leads/${lead.body.id}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ industry: "Retail" })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/leads/${lead.body.id}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post("/api/v1/leads/scoring-rules")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Blocked", field: "source", operator: "equals", value: "event", points: 5 })
      .expect(403);
  });
});
