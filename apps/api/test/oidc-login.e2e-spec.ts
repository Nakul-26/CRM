// Must run before any other import — same idiom as dunning-temporal.e2e-spec.ts
// and search-opensearch.e2e-spec.ts: test-app.ts reads these via `??=`, so
// setting them here (before it's imported, even transitively) is what makes
// this one spec file exercise the real Keycloak-backed OIDC login path while
// every other spec file keeps AUTH_OIDC_ENABLED=false and password login
// untouched. See docs/decisions/0017-keycloak-oidc-phase17-scope.md.
process.env.AUTH_OIDC_ENABLED = "true";
process.env.OIDC_ISSUER_URL ??= "http://localhost:8082/realms/sales-platform";
process.env.OIDC_CLIENT_ID ??= "sales-platform-api";
process.env.OIDC_CLIENT_SECRET ??= "dev-oidc-client-secret-change-me";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./setup/test-app";

// Matches docker/keycloak/realm-export.json's seeded test user.
const KEYCLOAK_USER_EMAIL = "sso-test@example.com";
const KEYCLOAK_USER_PASSWORD = "SsoTest123!";
const REDIRECT_URI = "http://localhost:3000/api/auth/oidc/callback";

// Already slug-shaped (lowercase, hyphenated, alphanumeric) so that
// OrganizationsService's slugify(name) is a no-op and this value can be
// passed straight through as organizationSlug below — no need to duplicate
// its internal slug-collision logic in a test. Randomized per run because
// the Keycloak-side test user's email is fixed (docker/keycloak/realm-export.json)
// and the test DB persists across separate Jest invocations: without a
// fresh org each run, a second run's registration would create a second
// local user for the same email, and login would become ambiguous across
// orgs (AMBIGUOUS_LOGIN) — organizationSlug disambiguates regardless of how
// many prior runs' orgs still exist.
function uniqueOrgSlug() {
  return `sso-test-org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Drives Keycloak's real login form to obtain a genuine authorization code —
 * no browser, no mocked ID token. Verified by hand against the running
 * container before being encoded here (see docs/decisions/0017-keycloak-oidc-phase17-scope.md
 * "Known implementation risks", item 2): the login page is scraped for its
 * form `action` URL, credentials are POSTed directly to it, and the
 * authorization code is read off the redirect's Location header.
 */
async function obtainAuthorizationCode(): Promise<string> {
  const issuer = process.env.OIDC_ISSUER_URL!;
  const clientId = process.env.OIDC_CLIENT_ID!;
  const authorizeUrl = new URL(`${issuer}/protocol/openid-connect/auth`);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "openid email");
  authorizeUrl.searchParams.set("state", "test-state");

  const loginPage = await fetch(authorizeUrl.toString(), { redirect: "follow" });
  // Keycloak binds the login form to this session via AUTH_SESSION_ID/
  // KC_RESTART cookies (confirmed empirically: the form POST is rejected
  // with 400 if these aren't carried forward) — plain fetch has no cookie
  // jar, so forward them by hand.
  const cookies = loginPage.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  const html = await loginPage.text();
  const actionMatch = /action="([^"]+)"/.exec(html);
  if (!actionMatch) {
    throw new Error("Could not find Keycloak login form action URL — realm-export.json or Keycloak version may have changed the login page shape.");
  }
  const formAction = actionMatch[1]!.replace(/&amp;/g, "&");

  const loginResponse = await fetch(formAction, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies },
    body: new URLSearchParams({ username: KEYCLOAK_USER_EMAIL, password: KEYCLOAK_USER_PASSWORD, credentialId: "" }),
    redirect: "manual",
  });

  const location = loginResponse.headers.get("location");
  if (!location) {
    throw new Error(`Keycloak login did not redirect (status ${loginResponse.status}) — check the seeded test user's credentials in realm-export.json.`);
  }
  const code = new URL(location).searchParams.get("code");
  if (!code) {
    throw new Error(`Keycloak redirect had no authorization code: ${location}`);
  }
  return code;
}

describe("OIDC login via Keycloak (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("logs in an already-provisioned local user via a real Keycloak authorization-code round trip", async () => {
    // Provision the local user first — OIDC never auto-provisions (see the ADR).
    const orgSlug = uniqueOrgSlug();
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        organizationName: orgSlug,
        fullName: "SSO Test",
        email: KEYCLOAK_USER_EMAIL,
        password: "SuperSecret123",
      })
      .expect(201);

    const code = await obtainAuthorizationCode();

    // organizationSlug disambiguates in case a prior test run left another
    // local user with this same (Keycloak-fixed) email in a different org.
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/oidc/token")
      .send({ code, redirectUri: REDIRECT_URI, organizationSlug: orgSlug })
      .expect(200);

    expect(res.body.tokens.accessToken).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(KEYCLOAK_USER_EMAIL);

    // The issued token works exactly like a password-login token against a
    // real protected route — same completeLogin() tail, same AuthenticatedUser.
    await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${res.body.tokens.accessToken}`)
      .expect(200);
  }, 30000);

  it("rejects an OIDC login for an email with no matching local user", async () => {
    const code = await obtainAuthorizationCode();

    // Using the same Keycloak identity again would collide with a local user
    // from a prior run of the test above, so instead assert against a code
    // exchange that never had a local /auth/register call for this org —
    // simplest reliable way: an org-scoped lookup for a slug that can't match.
    await request(app.getHttpServer())
      .post("/api/v1/auth/oidc/token")
      .send({ code, redirectUri: REDIRECT_URI, organizationSlug: "no-such-org-xyz" })
      .expect(401);
  }, 30000);

  // "Rejects OIDC login entirely when AUTH_OIDC_ENABLED is not set" used to
  // live here as a second-app-instance e2e test, spinning up a fresh
  // createTestApp() after flipping process.env.AUTH_OIDC_ENABLED = "false".
  // It doesn't work: apps/api/src/app.module.ts reads env eagerly at
  // module-evaluation time (`const env = loadApiEnv()`, added in Phase 18 so
  // its NotificationsModule import can branch on it), and Node's require
  // cache means a second createTestApp() call within the same file returns
  // the *already-decorated* AppModule/ConfigModule from the `app` built in
  // beforeAll above — the env flip is silently ignored. Forcing a fresh
  // module graph via jest.resetModules() "fixes" that but breaks NestJS's
  // DI token identity for framework-level singletons (Reflector) shared
  // across the two module graphs, throwing a *different*, worse error.
  // Building a live-reading ConfigService just for this one edge case would
  // be a disproportionate architecture change. The behavior itself is
  // already precisely covered, in isolation, by
  // oidc.service.spec.ts's "throws (does not silently no-op) when
  // AUTH_OIDC_ENABLED is false" — this e2e duplicate added no real coverage
  // beyond that (and, before the NOTIFICATIONS_SERVICE_ENABLED-driven
  // z.coerce.boolean() fix in packages/config/src/env.ts, was silently
  // passing for the wrong reason: the literal string "false" coerced to
  // `true`, so it was actually exercising a real Keycloak round trip with a
  // garbage code, not the disabled path at all).
});
