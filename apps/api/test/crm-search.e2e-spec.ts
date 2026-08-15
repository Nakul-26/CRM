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

describe("CRM Search (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("finds accounts and contacts by name via full-text search, and never leaks another org's rows", async () => {
    const orgA = await registerOrg(app, "Search Org A", "sa");
    const orgB = await registerOrg(app, "Search Org B", "sb");

    await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ name: "Globodyne Corporation" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/v1/contacts")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ firstName: "Milton", lastName: "Waddams" })
      .expect(201);

    // Same distinctive name in org B — must never show up in org A's results.
    await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ name: "Globodyne Corporation" })
      .expect(201);

    const accountResults = await request(app.getHttpServer())
      .get("/api/v1/search?q=Globodyne")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .expect(200);
    expect(accountResults.body).toHaveLength(1);
    expect(accountResults.body[0]).toMatchObject({ type: "account", label: "Globodyne Corporation" });

    const contactResults = await request(app.getHttpServer())
      .get("/api/v1/search?q=Waddams")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .expect(200);
    expect(contactResults.body).toHaveLength(1);
    expect(contactResults.body[0]).toMatchObject({ type: "contact", label: "Milton Waddams" });

    // org B searching for the same term only ever sees its own row.
    const orgBResults = await request(app.getHttpServer())
      .get("/api/v1/search?q=Globodyne")
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(200);
    expect(orgBResults.body).toHaveLength(1);
  });

  it("respects a types filter and returns nothing for an empty query", async () => {
    const org = await registerOrg(app, "Filter Test Org", "ft");

    await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Filterable Account" })
      .expect(201);

    const accountsOnly = await request(app.getHttpServer())
      .get("/api/v1/search?q=Filterable&types=account")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(accountsOnly.body.every((r: { type: string }) => r.type === "account")).toBe(true);

    const contactsOnly = await request(app.getHttpServer())
      .get("/api/v1/search?q=Filterable&types=contact")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(contactsOnly.body).toHaveLength(0);

    const empty = await request(app.getHttpServer())
      .get("/api/v1/search?q=")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(empty.body).toHaveLength(0);
  });
});
