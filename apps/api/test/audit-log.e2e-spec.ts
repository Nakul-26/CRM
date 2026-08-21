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

/** Invites a second user in the same org with the given system role by name (e.g. "Owner", "Member"). */
async function inviteSecondUser(app: INestApplication, ownerToken: string, label: string, roleName: string) {
  const rolesRes = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", `Bearer ${ownerToken}`).expect(200);
  const role = rolesRes.body.find((r: { name: string }) => r.name === roleName);

  const invited = await request(app.getHttpServer())
    .post("/api/v1/users/invite")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ email: uniqueEmail(label), fullName: `${label} User`, roleIds: [role.id] })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
    .expect(200);
  return { id: invited.body.user.id as string, email: invited.body.user.email as string, accessToken: login.body.tokens.accessToken as string };
}

async function createAccount(app: INestApplication, token: string, name: string) {
  const res = await request(app.getHttpServer()).post("/api/v1/accounts").set("Authorization", `Bearer ${token}`).send({ name }).expect(201);
  return res.body as { id: string; name: string };
}

async function createOpportunity(app: INestApplication, token: string, accountId: string, name: string) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/opportunities")
    .set("Authorization", `Bearer ${token}`)
    .send({ name, accountId, value: 10000 })
    .expect(201);
  return res.body as { id: string; pipelineId: string };
}

async function createSentQuote(app: INestApplication, token: string, accountId: string, opportunityId?: string) {
  const created = await request(app.getHttpServer())
    .post("/api/v1/quotes")
    .set("Authorization", `Bearer ${token}`)
    .send({ accountId, opportunityId, lineItems: [{ name: "Widget", quantity: 1, unitPrice: 100 }] })
    .expect(201);
  const sent = await request(app.getHttpServer())
    .post(`/api/v1/quotes/${created.body.quote.id}/send`)
    .set("Authorization", `Bearer ${token}`)
    .expect(201);
  return sent.body.quote as { id: string; shareToken: string };
}

function listAuditLog(app: INestApplication, token: string, query = "") {
  return request(app.getHttpServer()).get(`/api/v1/audit-log${query}`).set("Authorization", `Bearer ${token}`).expect(200);
}

function exportAuditLog(app: INestApplication, token: string, query = "", expectStatus = 200) {
  return request(app.getHttpServer()).get(`/api/v1/audit-log/export${query}`).set("Authorization", `Bearer ${token}`).expect(expectStatus);
}

/**
 * AuditListener writes are fire-and-forget (DomainEventBus.publish uses a
 * synchronous emit, so an async @OnEvent handler's DB insert isn't awaited
 * before the triggering HTTP response returns) — same eventual-consistency
 * characteristic Mailpit polling (test/setup/mailpit.ts) already works
 * around for outbound email. Poll until a matching row shows up, or fail
 * with a clear timeout rather than an ambiguous "undefined" match error.
 */
async function waitForAuditEntry(
  app: INestApplication,
  token: string,
  query: string,
  predicate: (entry: { eventType: string; payload: Record<string, unknown> | null }) => boolean,
  timeoutMs = 5000,
): Promise<{ id: string; eventType: string; actorId: string | null; actorName: string | null; actorEmail: string | null; payload: Record<string, unknown> | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = await listAuditLog(app, token, query);
    const match = page.body.items.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for a matching audit log entry (query: "${query}")`);
}

/** Polls the total row count until it stops changing across consecutive checks, i.e. all async listener writes have settled. */
async function waitForStableAuditTotal(app: INestApplication, token: string, timeoutMs = 5000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let previous = -1;
  let stableStreak = 0;
  while (Date.now() < deadline) {
    const total = (await listAuditLog(app, token, "?limit=1")).body.total;
    stableStreak = total === previous ? stableStreak + 1 : 0;
    previous = total;
    if (stableStreak >= 3) return total;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return previous;
}

describe("Audit Log (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns bootstrap events after registration, with the actor resolved", async () => {
    const org = await registerOrg(app, "Audit Bootstrap Co", "ab");

    const orgCreated = await waitForAuditEntry(app, org.accessToken, "", (e) => e.eventType === "organization.created");
    expect(orgCreated).toMatchObject({ actorId: org.user.id, actorEmail: org.email });
  });

  it("records varied actions with the acting user's name/email attached via the join", async () => {
    const org = await registerOrg(app, "Audit Actions Co", "aa");
    const second = await inviteSecondUser(app, org.accessToken, "aa-second", "Owner");
    const account = await createAccount(app, org.accessToken, "Audit Account");

    const ticket = await request(app.getHttpServer())
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${second.accessToken}`)
      .send({ subject: "Audited ticket", accountId: account.id })
      .expect(201);

    const ticketCreated = await waitForAuditEntry(
      app,
      org.accessToken,
      "",
      (e) => e.eventType === "ticket.created" && e.payload?.ticketId === ticket.body.id,
    );
    expect(ticketCreated).toMatchObject({ actorId: second.id, actorEmail: second.email });
  });

  it("filters by eventType, actorId, and date range", async () => {
    const org = await registerOrg(app, "Audit Filter Co", "af");
    const account = await createAccount(app, org.accessToken, "Audit Filter Account");
    await createOpportunity(app, org.accessToken, account.id, "Filtered Deal");

    const byType = await listAuditLog(app, org.accessToken, "?eventType=account.created");
    expect(byType.body.items.length).toBeGreaterThan(0);
    expect(byType.body.items.every((e: { eventType: string }) => e.eventType === "account.created")).toBe(true);

    const byActor = await listAuditLog(app, org.accessToken, `?actorId=${org.user.id}`);
    expect(byActor.body.items.length).toBeGreaterThan(0);
    expect(byActor.body.items.every((e: { actorId: string | null }) => e.actorId === org.user.id)).toBe(true);

    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const noneInFuture = await listAuditLog(app, org.accessToken, `?dateFrom=${encodeURIComponent(farFuture)}`);
    expect(noneInFuture.body.items).toHaveLength(0);

    const past = new Date(Date.now() - 60_000).toISOString();
    const someRecently = await listAuditLog(app, org.accessToken, `?dateFrom=${encodeURIComponent(past)}`);
    expect(someRecently.body.items.length).toBeGreaterThan(0);
  });

  it("paginates with limit/offset without gaps or overlap, and reports the true total", async () => {
    const org = await registerOrg(app, "Audit Page Co", "ap");
    const account = await createAccount(app, org.accessToken, "Audit Page Account");
    // Each opportunity create publishes at least one event, easily exceeding a limit of 2.
    for (let i = 0; i < 3; i++) {
      await createOpportunity(app, org.accessToken, account.id, `Deal ${i}`);
    }

    await waitForStableAuditTotal(app, org.accessToken);
    const full = await listAuditLog(app, org.accessToken, "?limit=200");
    expect(full.body.total).toBe(full.body.items.length);
    expect(full.body.total).toBeGreaterThanOrEqual(4);

    const pageSize = 2;
    const collected: string[] = [];
    for (let offset = 0; offset < full.body.total; offset += pageSize) {
      const page = await listAuditLog(app, org.accessToken, `?limit=${pageSize}&offset=${offset}`);
      expect(page.body.total).toBe(full.body.total);
      expect(page.body.items.length).toBeLessThanOrEqual(pageSize);
      collected.push(...page.body.items.map((e: { id: string }) => e.id));
    }
    expect(collected).toEqual(full.body.items.map((e: { id: string }) => e.id));
    expect(new Set(collected).size).toBe(collected.length);
  });

  it("records system-triggered events (no actor) with a null actorId/actorName", async () => {
    const org = await registerOrg(app, "Audit System Co", "as");
    const account = await createAccount(app, org.accessToken, "Audit System Account");
    const opportunity = await createOpportunity(app, org.accessToken, account.id, "Auto Deal");
    const quote = await createSentQuote(app, org.accessToken, account.id, opportunity.id);

    // Public acceptance has no authenticated actor; the opportunity auto-advances via a
    // system-triggered opportunity.won event (no actorId), per Phase 8's automation.
    await request(app.getHttpServer()).post(`/api/v1/public/quotes/${quote.shareToken}/accept`).expect(201);

    const won = await waitForAuditEntry(app, org.accessToken, "?eventType=opportunity.won", () => true);
    expect(won).toMatchObject({ actorId: null, actorName: null });
  });

  it("isolates audit log rows per organization", async () => {
    const orgA = await registerOrg(app, "Audit Iso A", "aia");
    const orgB = await registerOrg(app, "Audit Iso B", "aib");
    await createAccount(app, orgA.accessToken, "Iso A Account");

    const pageB = await listAuditLog(app, orgB.accessToken);
    const leaked = pageB.body.items.find((e: { payload: { name?: string } }) => e.payload?.name === "Iso A Account");
    expect(leaked).toBeUndefined();
  });

  it("requires the audit.log.view permission, and authentication", async () => {
    const org = await registerOrg(app, "Audit Perm Co", "ape");
    const member = await inviteSecondUser(app, org.accessToken, "ape-member", "Member");

    await listAuditLog(app, org.accessToken); // Owner has it — succeeds (asserted via 200 inside helper).
    await request(app.getHttpServer()).get("/api/v1/audit-log").set("Authorization", `Bearer ${member.accessToken}`).expect(403);
    await request(app.getHttpServer()).get("/api/v1/audit-log").expect(401);
  });

  describe("CSV export", () => {
    it("returns a CSV with the expected headers, content type, and disposition", async () => {
      const org = await registerOrg(app, "Audit Export Co", "aec");
      await createAccount(app, org.accessToken, "Export Account");
      await waitForAuditEntry(app, org.accessToken, "", (e) => e.eventType === "account.created");

      const res = await exportAuditLog(app, org.accessToken);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment");
      expect(res.headers["content-disposition"]).toContain(".csv");

      const [header, ...rows] = res.text.trim().split("\r\n");
      expect(header).toBe("ID,When,Event Type,Actor ID,Actor Name,Actor Email,IP,User Agent,Payload");
      expect(rows.some((row) => row.includes("account.created"))).toBe(true);
    });

    it("narrows exported rows by the eventType filter, same as the list endpoint", async () => {
      const org = await registerOrg(app, "Audit Export Filter Co", "aef");
      const account = await createAccount(app, org.accessToken, "Export Filter Account");
      await createOpportunity(app, org.accessToken, account.id, "Export Filter Deal");
      await waitForStableAuditTotal(app, org.accessToken);

      const res = await exportAuditLog(app, org.accessToken, "?eventType=account.created");
      const [, ...rows] = res.text.trim().split("\r\n");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.includes("account.created"))).toBe(true);
    });

    it("requires the audit.log.view permission, and authentication", async () => {
      const org = await registerOrg(app, "Audit Export Perm Co", "aep");
      const member = await inviteSecondUser(app, org.accessToken, "aep-member", "Member");

      await exportAuditLog(app, org.accessToken); // Owner has it — succeeds.
      await request(app.getHttpServer()).get("/api/v1/audit-log/export").set("Authorization", `Bearer ${member.accessToken}`).expect(403);
      await request(app.getHttpServer()).get("/api/v1/audit-log/export").expect(401);
    });
  });
});
