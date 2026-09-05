# Phase 17 — Keycloak (opt-in OIDC login, additive to first-party password auth)

## Context

[ADR 0001](../decisions/0001-modular-monolith.md) deferred Keycloak/OIDC from day one; the architecture overview's deferral table names the trigger as "External SSO customers are a real, committed requirement" — a trigger that, like OpenSearch's, hasn't concretely fired, but the user asked to work through all five originally-deferred items regardless. RabbitMQ (Phase 14), OpenSearch (Phase 15), and Temporal (Phase 16) are done; this is explicitly flagged as "most invasive of the remaining items (touches every module's auth)."

**Current auth system** (confirmed by reading the code): `AuthService` (`apps/api/src/modules/identity/auth/auth.service.ts`) issues a self-signed access JWT (claims: `sub`, `organizationId`, `email`, `fullName`, `permissions` — permissions baked in at issue time) plus an opaque, hashed-at-rest refresh token (rotation with reuse detection). `JwtAuthGuard` (`apps/api/src/shared/guards/jwt-auth.guard.ts`) verifies the access JWT directly via `@nestjs/jwt` (no Passport), sets `request.user: AuthenticatedUser` and calls `RequestContextService.setAuth(...)` — **this is the only place multi-tenancy/RBAC context gets populated**, and it's fully decoupled from *how* the token was validated. `PermissionsGuard` and all 268 `@RequirePermissions`/`@CurrentUser`/`@Public` call-sites across 26 controllers key off `request.user` alone, never JWT internals. The frontend (`apps/web`) never lets tokens touch client JS — a Next.js BFF route (`apps/web/src/app/api/auth/login/route.ts`) calls the API, then sets httpOnly cookies via `setAuthCookies`; a gateway proxy attaches `Bearer` server-side on every request.

**Given that decoupling**, the actual invasive risk isn't "every module's auth" (RBAC/multi-tenancy are untouched by construction) — it's specifically the login/token-issuance path. This phase is scoped honestly and minimally as a result: **Keycloak becomes an additional, opt-in way to obtain the app's own token pair for an *already-provisioned* local user** — not a replacement for password login, and not a new identity-provisioning system. This mirrors Phase 13-16's "pluggable, safe default, real working opt-in" shape as closely as auth allows: nothing about existing register/login/refresh/logout/RBAC changes; a new path is added alongside it, inert unless explicitly enabled.

## Scope decisions

| Decision | Reasoning |
|---|---|
| **`AUTH_OIDC_ENABLED=false` by default**, plus `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` (server-side only, optional, only read when enabled). When disabled, `OidcService`'s config getter throws before any network call — zero behavior change, zero new dependency, matching every prior phase's default-safety bar. | Consistent shape with `PAYMENT_PROVIDER`/`EVENT_BUS_TRANSPORT`/`SEARCH_PROVIDER`/`WORKFLOW_ENGINE`, adapted to "additive capability" rather than "swap-in replacement" since auth has no safe "replace" default. |
| **OIDC authenticates an existing local user by verified email — no JIT auto-provisioning.** A Keycloak login for an email with no matching local `users` row (within the resolved organization) is rejected, same as it would be a `INVALID_CREDENTIALS`-shaped rejection. The ID token's `email_verified` claim must be `true`. | Keeps this phase's blast radius to "an alternate credential check," not "a new account-creation policy" — auto-provisioning is a real, separate policy decision (which role? which org, if ambiguous?) with no concrete need yet. Recorded as an explicit, separable deferral. |
| **Reuse the existing token-issuing path completely.** `AuthService.login()`'s tail — after the password check succeeds — already does exactly "resolve permissions, build `AuthenticatedUser`, publish a login event, issue our own access+refresh tokens." Extract that into a shared private method; add `loginWithOidc(idTokenClaims, organizationSlug?)` that does the same *local user resolution* as `login()` (email lookup, optional `organizationSlug` disambiguation, `AMBIGUOUS_LOGIN` if unresolved) but replaces the bcrypt check with "the ID token was already verified against our configured Keycloak realm's JWKS." | The exact same `AuthResponse`/`AuthenticatedUser`/token pair comes out either way — `JwtAuthGuard`, `PermissionsGuard`, `RequestContextService`, and all 268 decorator call-sites need zero changes. |
| **Authorization-code flow, confidential client, `state` for CSRF** (no PKCE — PKCE exists to protect public clients that can't hold a secret; our client is confidential and the code exchange happens server-side in `apps/api`, holding `OIDC_CLIENT_SECRET`, so PKCE adds complexity without closing a real gap here). | Follows the OIDC spec's own guidance on when PKCE is/isn't required; keeps scope proportionate. |
| **Exactly one new business endpoint**: `POST /auth/oidc/token` (`{ code, redirectUri, organizationSlug? }` → `AuthResponse`, same shape as `/auth/login`). It exchanges the code for tokens directly with Keycloak's token endpoint (server-to-server, using `OIDC_CLIENT_SECRET`), verifies the returned ID token's signature via `jose`'s remote JWKS (against `OIDC_ISSUER_URL`), then calls `AuthService.loginWithOidc(...)`. `apps/web` owns the actual browser redirect dance (start + callback routes), matching how it already owns cookie-setting — `apps/api` never needs to know about browsers or cookies. | Minimal new API surface; keeps the "tokens never touch client JS" and "only `apps/web` sets cookies" invariants completely intact, exactly mirroring the existing `/auth/login` BFF pattern. |
| **`jose`** used directly for JWKS verification (`createRemoteJWKSet` + `jwtVerify`) — no `openid-client`/Passport-OIDC wrapper. Pinned to `^4.15.9`, not the initially-tried `^6.2.10`. | Matches house style (`amqplib`, `stripe`, `@opensearch-project/opensearch`, `@temporalio/*` are all plain client libraries, not framework wrappers). `jose@6.x` is pure ESM with no CJS export condition, which breaks Jest's default CommonJS transform outright (`SyntaxError: Unexpected token 'export'`) — and since `IdentityModule` unconditionally registers `OidcService`, this would have broken the *entire* e2e suite, not just OIDC tests. `jose@4.15.9` ships a proper dual CJS/ESM build and has the same stable API for this use case; downgrading was the minimal fix versus reconfiguring Jest's transform pipeline. |
| **`docker-compose.yml`** gains a `keycloak` service (`quay.io/keycloak/keycloak`, dev-mode start, port shifted) that auto-imports a checked-in realm-export JSON (`docker/keycloak/realm-export.json`) via `--import-realm` — pre-configured with one realm, one confidential client (client ID/secret matching `.env.example`'s defaults), and one seeded test user. Exact realm-JSON shape and any version-specific import quirks verified empirically against a real running container during implementation, same discipline as every prior phase's infra surprise (RabbitMQ's healthcheck, OpenSearch's admin-password requirement, Temporal's `DB=postgres12`/loopback-binding quirks). | Real infra, not a mock, and no manual admin-console setup required to exercise the flow locally or in e2e tests. |
| **`apps/web`** gets a "Sign in with SSO" button on the login page (shown only when `NEXT_PUBLIC_OIDC_ENABLED=true`), a `/api/auth/oidc/start/route.ts` (redirects to Keycloak's `/protocol/openid-connect/auth`, stashing a random `state` in a short-lived httpOnly cookie), and `/api/auth/oidc/callback/route.ts` (validates `state`, calls `apps/api`'s `POST /auth/oidc/token`, sets the same httpOnly cookies via the existing `setAuthCookies` helper, redirects into the dashboard) — byte-for-byte the same shape as the existing `/api/auth/login/route.ts`. | No new frontend architecture; reuses `setAuthCookies` and the existing gateway-proxy/cookie model unchanged. |
| **E2E test strategy — a real code obtained without a browser.** Keycloak's login page is a plain HTML form; the test extracts the form's `action` URL from the real page returned by `GET .../protocol/openid-connect/auth`, POSTs the seeded test user's credentials directly (a real HTTP request to the real Keycloak container, forwarding the `AUTH_SESSION_ID`/`KC_RESTART` session cookies Keycloak's login form is bound to — confirmed empirically to be required), and reads the resulting redirect's `Location` header for the genuine authorization `code` — then drives `POST /auth/oidc/token` with it. | Proves a genuine, signed-by-the-real-server round trip — not a mocked ID token — matching the "real infrastructure" bar every prior phase held to, without needing a headless browser. |
| **`AuthService` gets no new unit-test file — `loginWithOidc` is covered by the e2e spec instead.** Discovered mid-implementation: `register`/`login`/`refresh`/`logout` have never had mocked-DB unit tests in this codebase, only e2e coverage against a real DB (`test/auth.e2e-spec.ts`). | Keeps testing style consistent rather than introducing a one-off mocked-DB spec for a single new method; `OidcService` (pure JWKS/HTTP logic) still gets a proper unit spec since that matches how `StripePaymentProvider`/`OpenSearchSearchProvider` are tested. |
| **Not built this phase**: JIT user auto-provisioning on first OIDC login; OIDC logout/single-logout (SLO) propagation back to Keycloak; multiple simultaneous OIDC providers/realms; replacing password login entirely; SCIM/user-sync from Keycloak; mapping Keycloak realm roles to local permissions (permissions still come entirely from the local RBAC tables, matched by local user — Keycloak is authentication only, never authorization, in this phase). | Each is a reasonable, separable future increment given a concrete need, recorded here rather than silently gapped. |

## Backend

### `docker-compose.yml`
Added a `keycloak` service (`quay.io/keycloak/keycloak:latest`, `start-dev --import-realm`, admin user via env, port `8082:8080`), plus `docker/keycloak/realm-export.json` (one realm, one confidential client, one test user with a plaintext `credentials` entry Keycloak hashes on import). Healthcheck uses a raw `/dev/tcp` probe (no curl/wget in this image).

### Env — `packages/config/src/env.ts`
```ts
AUTH_OIDC_ENABLED: z.coerce.boolean().default(false),
OIDC_ISSUER_URL: z.string().optional(),
OIDC_CLIENT_ID: z.string().optional(),
OIDC_CLIENT_SECRET: z.string().optional(),
```
`webEnvSchema` gets `NEXT_PUBLIC_OIDC_ENABLED` only (simplified from the original draft after confirming no other `NEXT_PUBLIC_*` vars are used anywhere in `apps/web` — issuer/client-id/redirect-uri are server-only, matching the existing `API_INTERNAL_URL` convention).

### `apps/api/package.json`
`jose@^4.15.9`.

### `apps/api/src/modules/identity/auth/` (existing, modified)
- `oidc.service.ts` (new) — lazy JWKS client; `exchangeCodeForIdToken(code, redirectUri)`, `verifyIdToken(idToken)`.
- `auth.service.ts` (modified) — extracted `resolveLoginCandidate` + `completeLogin`; added `loginWithOidc(claims, organizationSlug?)`.
- `auth.controller.ts` (modified) — added `POST /auth/oidc/token` (`@Public()`), always mounted, internally rejecting when disabled.
- `identity.module.ts` (modified) — registered `OidcService`.

## Frontend

### `apps/web/src/app/api/auth/oidc/start/route.ts` (new)
Builds Keycloak's authorize URL from server-only `OIDC_*` env vars, sets a short-lived `sp_oidc_state` httpOnly cookie, redirects (302). Returns 404 if OIDC isn't configured.

### `apps/web/src/app/api/auth/oidc/callback/route.ts` (new)
Validates `state` against the cookie, calls `apps/api`'s `POST /auth/oidc/token`, sets auth cookies via the existing `setAuthCookies`, redirects into the dashboard — or back to `/login?error=...` on any failure.

### `apps/web/src/app/(auth)/login/page.tsx` (existing, modified)
Added a "Sign in with SSO" link (styled via a newly-exported `buttonVariants`, since the existing `Button` component has no `asChild` support) to `/api/auth/oidc/start`, rendered only when `NEXT_PUBLIC_OIDC_ENABLED === "true"`; surfaces `?error=` from the callback route as a friendly message.

## Testing

- **Unit**: `oidc.service.spec.ts` (`jest.mock("jose")`, mocked global `fetch`) — 6 tests covering successful verify, jose rejection, disabled-config rejection, missing-config error, successful code exchange, and Keycloak-rejects-the-code.
- **New e2e**: `apps/api/test/oidc-login.e2e-spec.ts` — three scenarios against the real Keycloak container: full round trip for an already-provisioned local user (asserted against a real protected route afterward), rejection when no local user matches, and rejection when `AUTH_OIDC_ENABLED` is left at its default (a second, freshly-compiled app instance).
- **Regression**: full existing unit suite (135/135, up from 129) and the full existing e2e suite re-run under the default `AUTH_OIDC_ENABLED=false` — zero behavior change to register/login/refresh/logout/RBAC.
- `test-app.ts`: `process.env.AUTH_OIDC_ENABLED ??= "false"`.

## Docs

- `docs/decisions/0017-keycloak-oidc-phase17-scope.md`.
- `docs/plans/0017-phase17-keycloak-plan.md` (this file).
- `docs/architecture/overview.md` — phase-link entry, deferral-table row update, new "Phase 17 scope" section.
- `README.md` — Phase 17 marked current (Phase 16 loses it); prerequisites/getting-started notes mention Keycloak is optional; "Why not" section updated.

## Verification

1. `docker compose up -d keycloak`, confirmed healthy and the realm-export imports cleanly.
2. Unit tests green (135/135).
3. New e2e spec green against the real Keycloak container (all three scenarios).
4. Full existing unit + e2e suites green under the default `AUTH_OIDC_ENABLED=false`.
5. `pnpm --filter @sales-platform/api build` and `pnpm --filter @sales-platform/web build` both clean; both apps' `typecheck` clean.

### Critical files
- `apps/api/src/modules/identity/auth/oidc.service.ts` (new)
- `apps/api/src/modules/identity/auth/auth.service.ts` (existing) — `resolveLoginCandidate`/`completeLogin` extraction + `loginWithOidc`
- `apps/api/src/modules/identity/auth/auth.controller.ts` (existing) — new endpoint
- `apps/web/src/app/api/auth/oidc/start/route.ts`, `.../callback/route.ts` (new)
- `apps/web/src/app/(auth)/login/page.tsx` (existing) — SSO button
- `packages/config/src/env.ts` (existing) — `AUTH_OIDC_ENABLED` + `OIDC_*` (api), `NEXT_PUBLIC_OIDC_ENABLED` (web)
- `docker-compose.yml` (existing) — new `keycloak` service
- `docker/keycloak/realm-export.json` (new)
- `apps/api/test/oidc-login.e2e-spec.ts` (new)

---

## Remaining deferred items after this phase

1. ~~RabbitMQ~~ — done (Phase 14).
2. ~~OpenSearch~~ — done (Phase 15).
3. ~~Temporal~~ — done (Phase 16).
4. ~~Keycloak~~ — done (this phase).
5. **Microservices split** — extracting one or more modules into separately deployable services, last, per ADR 0001's own "Consequences" section.
