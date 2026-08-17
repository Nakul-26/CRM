import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createTestApp } from "./setup/test-app";
import { DATABASE_CONNECTION, type Database } from "../src/database/database.module";
import { tickets } from "../src/database/schema";

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
  return res.body.id as string;
}

describe("Tickets (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a ticket, snapshotting due-at timestamps from the matching SLA policy", async () => {
    const org = await registerOrg(app, "Initrode Tickets", "it");
    const accountId = await createAccount(app, org.accessToken, "Initrode Account");

    await request(app.getHttpServer())
      .post("/api/v1/sla-policies")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "High SLA", priority: "high", firstResponseTargetMinutes: 60, resolutionTargetMinutes: 480 })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "Cannot log in", accountId, priority: "high" })
      .expect(201);

    expect(created.body.status).toBe("open");
    expect(created.body.firstResponseDueAt).not.toBeNull();
    expect(created.body.resolutionDueAt).not.toBeNull();
    const dueAt = new Date(created.body.resolutionDueAt).getTime();
    const createdAt = new Date(created.body.createdAt).getTime();
    expect(dueAt - createdAt).toBeCloseTo(480 * 60_000, -3);
    expect(created.body.firstResponseBreached).toBe(false);
    expect(created.body.resolutionBreached).toBe(false);
  });

  it("leaves due-at fields null when no SLA policy matches the ticket's priority", async () => {
    const org = await registerOrg(app, "Massive Dynamic Tickets", "mdt");
    const accountId = await createAccount(app, org.accessToken, "Massive Dynamic Account");

    const created = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "General question", accountId, priority: "low" })
      .expect(201);

    expect(created.body.firstResponseDueAt).toBeNull();
    expect(created.body.resolutionDueAt).toBeNull();
    expect(created.body.firstResponseBreached).toBe(false);
    expect(created.body.resolutionBreached).toBe(false);
  });

  it("shows SLA breach flags once due-at timestamps are in the past", async () => {
    const org = await registerOrg(app, "Umbrella Corp Tickets", "uct");
    const accountId = await createAccount(app, org.accessToken, "Umbrella Account");

    const created = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "Overdue ticket", accountId, priority: "urgent" })
      .expect(201);

    const db = app.get<Database>(DATABASE_CONNECTION);
    const past = new Date(Date.now() - 60_000);
    await db.update(tickets).set({ firstResponseDueAt: past, resolutionDueAt: past }).where(eq(tickets.id, created.body.id));

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/tickets/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(fetched.body.firstResponseBreached).toBe(true);
    expect(fetched.body.resolutionBreached).toBe(true);

    // Responding clears the first-response breach; resolving clears the resolution breach.
    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${created.body.id}/comments`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ body: "Looking into it", isPublic: true })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${created.body.id}/status`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ status: "resolved" })
      .expect(201);

    const resolved = await request(app.getHttpServer())
      .get(`/api/v1/tickets/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(resolved.body.firstResponseBreached).toBe(false);
    expect(resolved.body.resolutionBreached).toBe(false);
  });

  it("enforces the fixed status transition graph and allows reopening", async () => {
    const org = await registerOrg(app, "Wayne Enterprises Tickets", "wet");
    const accountId = await createAccount(app, org.accessToken, "Wayne Account");

    const created = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "Broken widget", accountId })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${created.body.id}/status`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ status: "resolved" })
      .expect(201);

    // resolved -> in_progress is not a valid transition (only open or closed from resolved).
    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${created.body.id}/status`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ status: "in_progress" })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${created.body.id}/status`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ status: "closed" })
      .expect(201);

    // closed -> open (reopen) is always allowed.
    const reopened = await request(app.getHttpServer())
      .post(`/api/v1/tickets/${created.body.id}/status`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ status: "open" })
      .expect(201);
    expect(reopened.body.status).toBe("open");
  });

  it("assigns a ticket to a user", async () => {
    const org = await registerOrg(app, "Stark Industries Tickets", "sit");
    const accountId = await createAccount(app, org.accessToken, "Stark Account");

    const created = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ subject: "VPN access", accountId })
      .expect(201);

    const assigned = await request(app.getHttpServer())
      .post(`/api/v1/tickets/${created.body.id}/assign`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ assigneeId: org.user.id })
      .expect(201);
    expect(assigned.body.assigneeId).toBe(org.user.id);

    const unassigned = await request(app.getHttpServer())
      .post(`/api/v1/tickets/${created.body.id}/assign`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ assigneeId: null })
      .expect(201);
    expect(unassigned.body.assigneeId).toBeNull();
  });

  it("404s when an org tries to read another org's ticket", async () => {
    const orgA = await registerOrg(app, "Acme A Tickets", "aat");
    const orgB = await registerOrg(app, "Acme B Tickets", "abt");
    const accountId = await createAccount(app, orgA.accessToken, "Acme A Account");

    const ticket = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ subject: "Org A ticket", accountId })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/tickets/${ticket.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);
  });

  it("enforces RBAC: a Member can create/edit/comment/transition tickets but cannot delete or reassign them", async () => {
    const org = await registerOrg(app, "Pepper Industries Tickets", "pit");
    const accountId = await createAccount(app, org.accessToken, "Pepper Account");

    const roles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-tickets"), fullName: "Pepper Member", roleIds: [memberRole.id] })
      .expect(201);
    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);
    const memberToken = memberLogin.body.tokens.accessToken as string;

    const created = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ subject: "Member-created ticket", accountId })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/tickets/${created.body.id}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ subject: "Updated subject" })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${created.body.id}/status`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ status: "in_progress" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${created.body.id}/comments`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ body: "Working on it" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/tickets/${created.body.id}/assign`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ assigneeId: org.user.id })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/tickets/${created.body.id}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(403);
  });
});
