/** Server-only: base URL the Next.js server uses to reach the API — never sent to the browser. */
export const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/**
 * Server-only: base URL for the extracted apps/notifications-service
 * (Phase 18's microservices split). Unset by default — the gateway proxy
 * (src/app/api/gateway/[...path]/route.ts) only routes `/notifications/*`
 * here when this is set, and falls back to API_INTERNAL_URL otherwise (the
 * monolith serving it in-process, as it always has). See
 * docs/decisions/0018-microservices-split-phase18-scope.md.
 */
export const NOTIFICATIONS_SERVICE_URL = process.env.NOTIFICATIONS_SERVICE_URL || undefined;

/**
 * Server-only OIDC config for the SSO login redirect — the client only ever
 * sees NEXT_PUBLIC_OIDC_ENABLED (whether to render the button); building the
 * actual Keycloak authorize URL happens in /api/auth/oidc/start, server-side.
 */
export const OIDC_ISSUER_URL = process.env.OIDC_ISSUER_URL ?? "";
export const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID ?? "";
export const OIDC_REDIRECT_URI = process.env.OIDC_REDIRECT_URI ?? "";

export const ACCESS_COOKIE = "sp_access_token";
export const REFRESH_COOKIE = "sp_refresh_token";

/** Access token cookie TTL mirrors the backend's JWT_ACCESS_TTL default (15m); refresh matches JWT_REFRESH_TTL (30d). */
export const ACCESS_COOKIE_MAX_AGE = 15 * 60;
export const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
