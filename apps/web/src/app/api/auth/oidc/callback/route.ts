import { NextResponse, type NextRequest } from "next/server";
import type { AuthResponse } from "@sales-platform/contracts";
import { API_INTERNAL_URL, OIDC_REDIRECT_URI } from "@/lib/server-config";
import { setAuthCookies } from "@/lib/auth-cookies";

const STATE_COOKIE = "sp_oidc_state";

function failure(request: NextRequest, reason: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", reason);
  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

/**
 * Keycloak redirects the browser here with `code`/`state` after a
 * successful login. Validates `state` against the cookie /start set (CSRF
 * guard), then exchanges the code for our own token pair via apps/api's
 * POST /auth/oidc/token — same BFF shape as /api/auth/login/route.ts:
 * tokens never reach client JS, only httpOnly cookies get set here.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;

  if (url.searchParams.get("error")) {
    return failure(request, "oidc_denied");
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return failure(request, "oidc_state_mismatch");
  }

  const apiRes = await fetch(`${API_INTERNAL_URL}/api/v1/auth/oidc/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, redirectUri: OIDC_REDIRECT_URI }),
  });

  if (!apiRes.ok) {
    return failure(request, "oidc_login_failed");
  }

  const { tokens } = (await apiRes.json()) as AuthResponse;
  const response = NextResponse.redirect(new URL("/", request.url));
  setAuthCookies(response, tokens);
  response.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
