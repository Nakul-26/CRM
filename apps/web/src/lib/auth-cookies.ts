import type { NextResponse } from "next/server";
import type { AuthTokens } from "@sales-platform/contracts";
import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE, REFRESH_COOKIE, REFRESH_COOKIE_MAX_AGE } from "./server-config";

const isProd = process.env.NODE_ENV === "production";

/** Tokens never reach client JS — they live only in httpOnly cookies set here. */
export function setAuthCookies(response: NextResponse, tokens: AuthTokens) {
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE,
  });
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.set(ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
}
