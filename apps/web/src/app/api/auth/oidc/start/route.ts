import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { OIDC_CLIENT_ID, OIDC_ISSUER_URL, OIDC_REDIRECT_URI } from "@/lib/server-config";

const STATE_COOKIE = "sp_oidc_state";

/**
 * Redirects the browser into Keycloak's own login page (authorization-code
 * flow, confidential client — the code exchange happens server-side in
 * apps/api, which holds the client secret; see
 * docs/decisions/0017-keycloak-oidc-phase17-scope.md). `state` is stashed in
 * a short-lived httpOnly cookie and checked back in the callback route to
 * guard against CSRF.
 */
export async function GET() {
  if (!OIDC_ISSUER_URL || !OIDC_CLIENT_ID || !OIDC_REDIRECT_URI) {
    return NextResponse.json(
      { error: { message: "SSO login is not configured" } },
      { status: 404 },
    );
  }

  const state = randomBytes(24).toString("hex");

  const authorizeUrl = new URL(`${OIDC_ISSUER_URL}/protocol/openid-connect/auth`);
  authorizeUrl.searchParams.set("client_id", OIDC_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", OIDC_REDIRECT_URI);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "openid email");
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 5 * 60,
  });
  return response;
}
