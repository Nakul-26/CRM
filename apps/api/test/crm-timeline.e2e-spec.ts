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

describe("CRM Timeline (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("merges logged activities and account/contact events, ordered most-recent-first, with type filtering", async () => {
    const org = await registerOrg(app, "Sterling Cooper", "sc");

    const account = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Lucky Strike" })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/accounts/${account.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ industry: "Tobacco" })
      .expect(200);

    const contact = await request(app.getHttpServer())
      .post("/api/v1/contacts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.body.id, firstName: "Don", lastName: "Draper" })
      .expect(201);

    const activity = await request(app.getHttpServer())
      .post("/api/v1/activities")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId: account.body.id, type: "call", subject: "Pitch call" })
      .expect(201);

    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.body.id}/timeline`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);

    const types = timeline.body.map((e: { type: string }) => e.type);
    // account.created, account.updated, contact.created (via its accountId), and the logged call.
    expect(types).toEqual(expect.arrayContaining(["account.created", "account.updated", "contact.created", "call"]));

    // Most-recent-first ordering.
    const occurredAts = timeline.body.map((e: { occurredAt: string }) => e.occurredAt);
    const sorted = [...occurredAts].sort().reverse();
    expect(occurredAts).toEqual(sorted);

    // Filtering by type narrows to just the logged activity.
    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.body.id}/timeline?type=call`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].id).toBe(activity.body.id);

    void contact; // created above to also emit a contact.created timeline event
  });

  it("404s when an org requests another org's account timeline", async () => {
    const orgA = await registerOrg(app, "Cutler Gleason & Chaough", "cg");
    const orgB = await registerOrg(app, "Duck Phillips CRM", "dp");

    const account = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ name: "Org A's account" })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.body.id}/timeline`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);
  });
});
