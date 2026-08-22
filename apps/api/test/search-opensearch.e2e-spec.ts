// Must run before any other import — test-app.ts reads these via `??=`, so
// setting them here (before it's imported, even transitively) is what makes
// this one spec file exercise the real OpenSearch-backed search path while
// every other spec file keeps using the default Postgres provider.
process.env.SEARCH_PROVIDER = "opensearch";
process.env.OPENSEARCH_URL ??= "http://localhost:9201";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./setup/test-app";

// OpenSearch's JVM cold-start (index creation, first-query JIT warm-up) is
// slower than Postgres/RabbitMQ's — give this file's tests more headroom
// than Jest's 30s default.
jest.setTimeout(60000);

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

function search(app: INestApplication, token: string, q: string) {
  return request(app.getHttpServer())
    .get(`/api/v1/search?q=${encodeURIComponent(q)}`)
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
}

/**
 * Under SEARCH_PROVIDER=opensearch, indexing happens asynchronously via
 * SearchIndexListener off the domain event bus (same fire-and-forget
 * characteristic as AuditListener — see audit-log.e2e-spec.ts's own
 * waitForAuditEntry). Polling proves a genuine index + query round-trip
 * against the real container, not just that the write call didn't throw.
 */
async function waitForSearchHit(
  app: INestApplication,
  token: string,
  q: string,
  predicate: (hit: { id: string; type: string; label: string }) => boolean,
  timeoutMs = 10000,
): Promise<{ id: string; type: string; label: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await search(app, token, q);
    const match = (res.body as { id: string; type: string; label: string }[]).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for a matching OpenSearch hit (q: "${q}")`);
}

describe("Search over OpenSearch (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("indexes a newly-created account via the domain event bus and finds it through a real OpenSearch query", async () => {
    const org = await registerOrg(app, "OpenSearch Search Co", "opensearch-search");

    const created = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Globex Aerodynamics" })
      .expect(201);

    const hit = await waitForSearchHit(app, org.accessToken, "Globex", (h) => h.id === created.body.id);

    expect(hit).toMatchObject({ id: created.body.id, type: "account", label: "Globex Aerodynamics" });
  });

  it("removes a deleted account from the index", async () => {
    const org = await registerOrg(app, "OpenSearch Delete Co", "opensearch-delete");

    const created = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Zorbex Vanishing Corp" })
      .expect(201);

    await waitForSearchHit(app, org.accessToken, "Zorbex", (h) => h.id === created.body.id);

    await request(app.getHttpServer())
      .delete(`/api/v1/accounts/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    const deadline = Date.now() + 5000;
    let stillPresent = true;
    while (Date.now() < deadline) {
      const res = await search(app, org.accessToken, "Zorbex");
      stillPresent = (res.body as { id: string }[]).some((h) => h.id === created.body.id);
      if (!stillPresent) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(stillPresent).toBe(false);
  });
});
