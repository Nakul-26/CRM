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

describe("CRM Activities (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("logs, lists (filtered), updates, and deletes an activity", async () => {
    const org = await registerOrg(app, "Vandelay Industries", "va");
    const account = await createAccount(app, org.accessToken, "Kramerica");

    const created = await request(app.getHttpServer())
      .post("/api/v1/activities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.id, type: "call", subject: "Intro call" })
      .expect(201);
    expect(created.body.subject).toBe("Intro call");
    expect(created.body.type).toBe("call");

    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/activities?accountId=${account.id}&type=call`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(filtered.body.map((a: { id: string }) => a.id)).toContain(created.body.id);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/activities/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "Intro call (rescheduled)" })
      .expect(200);
    expect(updated.body.subject).toBe("Intro call (rescheduled)");

    await request(app.getHttpServer())
      .delete(`/api/v1/activities/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/activities/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(404);
  });

  it("rejects an activity with neither accountId nor contactId", async () => {
    const org = await registerOrg(app, "Pendant Publishing", "pe");

    await request(app.getHttpServer())
      .post("/api/v1/activities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ type: "note", subject: "Orphan activity" })
      .expect(400);
  });

  it("rejects a cross-org accountId when logging an activity", async () => {
    const orgA = await registerOrg(app, "Yankee Bureau", "yb");
    const orgB = await registerOrg(app, "H&H Bagels", "hh");
    const orgAAccount = await createAccount(app, orgA.accessToken, "Org A's account");

    await request(app.getHttpServer())
      .post("/api/v1/activities")
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ accountId: orgAAccount.id, type: "note", subject: "Cross-tenant attempt" })
      .expect(404);
  });

  it("404s when an org tries to read, update, or delete another org's activity", async () => {
    const orgA = await registerOrg(app, "Art Vandelay Imports", "av2");
    const orgB = await registerOrg(app, "Del Boca Vista", "db");
    const account = await createAccount(app, orgA.accessToken, "Latex Alarms");

    const activity = await request(app.getHttpServer())
      .post("/api/v1/activities")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ accountId: account.id, type: "meeting", subject: "Org A's activity" })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/activities/${activity.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/activities/${activity.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ subject: "Hacked" })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/activities/${activity.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);
  });

  it("scopes activities to a specific opportunity, distinct from other opportunities on the same account", async () => {
    const org = await registerOrg(app, "Sabre Corp", "sb");
    const account = await createAccount(app, org.accessToken, "Sabre");

    const oppA = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Renewal", accountId: account.id })
      .expect(201);
    const oppB = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Upsell", accountId: account.id })
      .expect(201);

    const activityA = await request(app.getHttpServer())
      .post("/api/v1/activities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ opportunityId: oppA.body.id, type: "call", subject: "Renewal check-in" })
      .expect(201);
    expect(activityA.body.opportunityId).toBe(oppA.body.id);

    const listA = await request(app.getHttpServer())
      .get(`/api/v1/activities?opportunityId=${oppA.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(listA.body.map((a: { id: string }) => a.id)).toEqual([activityA.body.id]);

    const listB = await request(app.getHttpServer())
      .get(`/api/v1/activities?opportunityId=${oppB.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(listB.body).toHaveLength(0);
  });

  it("rejects a cross-org opportunityId when logging an activity", async () => {
    const orgA = await registerOrg(app, "Aviato", "av3");
    const orgB = await registerOrg(app, "Hooli XYZ", "hx");
    const accountA = await createAccount(app, orgA.accessToken, "Aviato Corp");
    const oppA = await request(app.getHttpServer())
      .post("/api/v1/opportunities")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ name: "Org A deal", accountId: accountA.id })
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/v1/activities")
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ opportunityId: oppA.body.id, type: "note", subject: "Cross-tenant attempt" })
      .expect(404);
  });

  it("enforces RBAC: a Member cannot delete an activity", async () => {
    const org = await registerOrg(app, "Kruger Industrial Smoothing", "ks");
    const account = await createAccount(app, org.accessToken, "Smoothing Co");

    const roles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-activity"), fullName: "Mel Member", roleIds: [memberRole.id] })
      .expect(201);

    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);

    const activity = await request(app.getHttpServer())
      .post("/api/v1/activities")
      .set("Authorization", `Bearer ${memberLogin.body.tokens.accessToken}`)
      .send({ accountId: account.id, type: "task", subject: "Member-made task" })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/activities/${activity.body.id}`)
      .set("Authorization", `Bearer ${memberLogin.body.tokens.accessToken}`)
      .expect(403);
  });
});
