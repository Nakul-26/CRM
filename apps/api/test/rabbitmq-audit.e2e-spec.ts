// Must run before any other import — test-app.ts reads these via `??=`, so
// setting them here (before it's imported, even transitively) is what makes
// this one spec file exercise the real RabbitMQ-backed audit pipeline while
// every other spec file keeps using the default in-process transport.
process.env.EVENT_BUS_TRANSPORT = "rabbitmq";
process.env.RABBITMQ_URL ??= "amqp://guest:guest@localhost:5673";

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
  return { accessToken: res.body.tokens.accessToken as string };
}

async function createAccount(app: INestApplication, token: string, name: string) {
  const res = await request(app.getHttpServer()).post("/api/v1/accounts").set("Authorization", `Bearer ${token}`).send({ name }).expect(201);
  return res.body as { id: string; name: string };
}

function listAuditLog(app: INestApplication, token: string, query = "") {
  return request(app.getHttpServer()).get(`/api/v1/audit-log${query}`).set("Authorization", `Bearer ${token}`).expect(200);
}

/**
 * Under EVENT_BUS_TRANSPORT=rabbitmq, the audit row is written by a queue
 * consumer, not synchronously — an even longer eventual-consistency window
 * than the in-process fire-and-forget case (see audit-log.e2e-spec.ts's own
 * waitForAuditEntry). Polling proves a genuine broker round-trip happened,
 * not just that the publish call didn't throw.
 */
async function waitForAuditEntry(
  app: INestApplication,
  token: string,
  query: string,
  predicate: (entry: { eventType: string; payload: Record<string, unknown> | null }) => boolean,
  timeoutMs = 10000,
): Promise<{ id: string; eventType: string; payload: Record<string, unknown> | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = await listAuditLog(app, token, query);
    const match = page.body.items.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for a matching audit log entry via RabbitMQ (query: "${query}")`);
}

describe("Audit log over RabbitMQ (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("delivers a domain event through a real broker round-trip and writes the audit row", async () => {
    const org = await registerOrg(app, "RabbitMQ Audit Co", "rabbitmq-audit");
    const account = await createAccount(app, org.accessToken, "Broker-Delivered Account");

    const entry = await waitForAuditEntry(
      app,
      org.accessToken,
      "?eventType=account.created",
      (e) => (e.payload as { accountId?: string } | null)?.accountId === account.id,
    );

    expect(entry.eventType).toBe("account.created");
  });
});
