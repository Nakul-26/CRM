import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./setup/test-app";

function uniqueEmail() {
  return `owner-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

describe("Auth flow (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers a new organization + owner and returns tokens", async () => {
    const email = uniqueEmail();
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        organizationName: "Acme Corp",
        fullName: "Ada Owner",
        email,
        password: "SuperSecret123",
      })
      .expect(201);

    expect(res.body.tokens.accessToken).toEqual(expect.any(String));
    expect(res.body.tokens.refreshToken).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(email);
    // Owner gets every permission, seeded automatically on registration.
    expect(res.body.user.permissions).toEqual(expect.arrayContaining(["identity.users.invite", "crm.accounts.view"]));
  });

  it("rejects registration with a weak password before touching the database", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ organizationName: "Acme", fullName: "Ada", email: uniqueEmail(), password: "short" })
      .expect(400);
  });

  it("logs in with correct credentials and rejects incorrect ones", async () => {
    const email = uniqueEmail();
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ organizationName: "Beta Inc", fullName: "Bob Owner", email, password: "SuperSecret123" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password: "WrongPassword" })
      .expect(401);

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password: "SuperSecret123" })
      .expect(200);

    expect(res.body.user.email).toBe(email);
  });

  it("rejects protected routes without a token, and accepts them with one", async () => {
    await request(app.getHttpServer()).get("/api/v1/auth/me").expect(401);

    const email = uniqueEmail();
    const { body } = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ organizationName: "Gamma LLC", fullName: "Gigi Owner", email, password: "SuperSecret123" })
      .expect(201);

    await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${body.tokens.accessToken}`)
      .expect(200);
  });

  it("rotates refresh tokens and detects reuse of an already-rotated token", async () => {
    const email = uniqueEmail();
    const { body } = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ organizationName: "Delta Co", fullName: "Dana Owner", email, password: "SuperSecret123" })
      .expect(201);

    const firstRefreshToken = body.tokens.refreshToken;

    const refreshed = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: firstRefreshToken })
      .expect(200);

    expect(refreshed.body.tokens.refreshToken).not.toBe(firstRefreshToken);

    // Reusing the now-rotated-away first token must fail closed.
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: firstRefreshToken })
      .expect(401);

    // And because reuse was detected, the *new* token that replaced it
    // should have been revoked too (all sessions killed).
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: refreshed.body.tokens.refreshToken })
      .expect(401);
  });

  it("logs out with only the refresh token (no access token required) and revokes it", async () => {
    const email = uniqueEmail();
    const { body } = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ organizationName: "Epsilon Ltd", fullName: "Eve Owner", email, password: "SuperSecret123" })
      .expect(201);

    // No Authorization header on purpose — logout must not require a live
    // access token, only proof of refresh-token possession.
    await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .send({ refreshToken: body.tokens.refreshToken })
      .expect(204);

    // The revoked refresh token can no longer be used.
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: body.tokens.refreshToken })
      .expect(401);
  });
});
