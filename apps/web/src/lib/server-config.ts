/** Server-only: base URL the Next.js server uses to reach the API — never sent to the browser. */
export const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

export const ACCESS_COOKIE = "sp_access_token";
export const REFRESH_COOKIE = "sp_refresh_token";

/** Access token cookie TTL mirrors the backend's JWT_ACCESS_TTL default (15m); refresh matches JWT_REFRESH_TTL (30d). */
export const ACCESS_COOKIE_MAX_AGE = 15 * 60;
export const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
