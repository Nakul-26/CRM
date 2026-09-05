# ADR 0017: Keycloak Phase 17 scope — opt-in OIDC login, additive to password auth

## Status

Accepted — 2026-09-02

## Context

[ADR 0001](0001-modular-monolith.md) deferred Keycloak/OIDC from day one.
RabbitMQ (Phase 14), OpenSearch (Phase 15), and Temporal (Phase 16) are
done; Keycloak is next per the user's standing instruction to work through
all five originally-deferred items, flagged up front as the most invasive
of the remaining ones since it touches auth.

**Current auth system** (confirmed by reading the code): `AuthService`
(`apps/api/src/modules/identity/auth/auth.service.ts`) issues a self-signed
access JWT (claims: `sub`, `organizationId`, `email`, `fullName`,
`permissions` — baked in at issue time) plus an opaque, hashed-at-rest
refresh token (rotation with reuse detection). `JwtAuthGuard` verifies the
access JWT directly via `@nestjs/jwt` (no Passport), sets `request.user` and
calls `RequestContextService.setAuth(...)` — the only place multi-tenancy/
RBAC context gets populated, fully decoupled from *how* the token was
validated. `PermissionsGuard` and all 268 `@RequirePermissions`/
`@CurrentUser`/`@Public` call-sites across 26 controllers key off
`request.user` alone, never JWT internals. The frontend (`apps/web`) never
lets tokens touch client JS — a Next.js BFF route calls the API, then sets
httpOnly cookies; a gateway proxy attaches `Bearer` server-side.

**Given that decoupling**, the actual invasive risk isn't "every module's
auth" (RBAC/multi-tenancy are untouched by construction) — it's
specifically the login/token-issuance path. This phase is scoped honestly
and minimally as a result.

## Decisions

**1. Keycloak is an additional, opt-in way to obtain the app's own token
pair for an *already-provisioned* local user** — not a replacement for
password login, not a new identity-provisioning system. `AUTH_OIDC_ENABLED`
defaults to `false`; when disabled, `POST /auth/oidc/token` still exists as
a route (simpler than conditionally mounting it) but unconditionally
rejects with the same `INVALID_CREDENTIALS` shape as a bad password —
`OidcService.getConfig()` throws before any network call is made.

**2. No JIT auto-provisioning.** `AuthService.loginWithOidc(claims,
organizationSlug?)` requires `claims.email_verified === true`, then runs
the exact same local-user resolution `login()` does (email lookup, optional
`organizationSlug` disambiguation, `AMBIGUOUS_LOGIN` if unresolved) — a
Keycloak login for an email with no matching local `users` row is rejected,
not auto-created. Auto-provisioning is a real, separable policy decision
(which role? which org?) deferred with no concrete need yet.

**3. The exact same token-issuing path is reused completely.**
`AuthService.login()` was refactored into `resolveLoginCandidate(email,
organizationSlug?)` (shared local-user resolution) + `completeLogin(user)`
(permissions lookup, event publish, `issueTokens`) — the shared tail of
every successful login regardless of credential method.
`loginWithOidc` calls both, skipping only the password comparison
`login()` does in between. The exact same `AuthResponse`/
`AuthenticatedUser`/token pair comes out either way — `JwtAuthGuard`,
`PermissionsGuard`, `RequestContextService`, and all 268 decorator
call-sites need zero changes.

**4. Authorization-code flow, confidential client, `state` for CSRF, no
PKCE.** PKCE protects public clients that can't hold a secret; our client
is confidential and the code exchange happens server-to-server in
`apps/api` (holding `OIDC_CLIENT_SECRET`), so PKCE would add complexity
without closing a real gap.

**5. Exactly one new business endpoint**: `POST /auth/oidc/token` (`{ code,
redirectUri, organizationSlug? }` → `AuthResponse`, same shape as
`/auth/login`). `OidcService.exchangeCodeForIdToken` posts to Keycloak's
token endpoint directly; `verifyIdToken` verifies the returned ID token's
signature via `jose`'s remote JWKS (`createRemoteJWKSet` + `jwtVerify`,
checking issuer + audience). `apps/web` owns the browser redirect dance
(`/api/auth/oidc/start`, `/api/auth/oidc/callback`) exactly like it already
owns cookie-setting for password login — `apps/api` never needs to know
about browsers or cookies.

**6. `jose` pinned to `^4.15.9`, not the initially-tried `^6.2.10` — a
real, concrete fix, not a style preference.** `jose@6.x` ships pure ESM
(`package.json` `"type": "module"`, no `require` condition in its exports
map), which Jest's default CommonJS transform cannot load at all
(`SyntaxError: Unexpected token 'export'` at
`jose/dist/webapi/index.js:1`, confirmed by a minimal reproduction spec).
Since `IdentityModule` unconditionally registers `OidcService`, and every
e2e test boots the full `AppModule`, this would have broken the *entire*
e2e suite, not just OIDC-specific tests. `jose@4.15.9`'s package.json
`exports["."]` has a proper dual `require`/`import` map
(`./dist/node/cjs/index.js` / `./dist/node/esm/index.js`) — confirmed via
`npm view jose@4.15.9 exports --json` — and its stable API
(`createRemoteJWKSet`, `jwtVerify`) is unchanged for this use case. A
downgrade was the minimal fix versus reconfiguring Jest's transform
pipeline for one dependency.

**7. `docker-compose.yml`** gains a `keycloak` service
(`quay.io/keycloak/keycloak:latest`, `start-dev --import-realm`, port
shifted to `8082:8080`) that auto-imports a checked-in
`docker/keycloak/realm-export.json` — one realm (`sales-platform`), one
confidential client (`sales-platform-api`, secret matching `.env.example`),
one seeded test user (`sso-test@example.com`, `emailVerified: true`).
Two version-specific quirks were found and fixed empirically, same
discipline as every prior phase's infra surprise:
- No `curl`/`wget` in this image (UBI-micro base) — the healthcheck uses a
  raw `/dev/tcp` probe via the shell's own redirection instead.
- Keycloak binds the login form to its session via `AUTH_SESSION_ID`/
  `KC_RESTART` cookies (confirmed empirically: the login-form POST is
  rejected with 400 if these aren't carried forward from the initial
  `GET .../auth` response) — both the manual verification and the e2e
  test's `obtainAuthorizationCode()` helper forward them by hand, since
  plain `fetch` has no cookie jar.

**8. E2E test strategy — a real code obtained without a browser.**
`apps/api/test/oidc-login.e2e-spec.ts` extracts the login form's `action`
URL from the real HTML Keycloak returns, POSTs the seeded test user's
credentials (with the session cookies above) directly to it, and reads the
genuine authorization `code` off the redirect's `Location` header — then
drives `POST /auth/oidc/token` with it. Three scenarios: a full round trip
for an already-provisioned local user (asserted against a real protected
route afterward), rejection when no local user matches (`organizationSlug`
scoped to a nonexistent org), and rejection when `AUTH_OIDC_ENABLED` is
left at its default (a second, freshly-compiled Nest app instance, since
`ConfigModule.forRoot({ load: [...] })`'s factory is only re-evaluated on a
fresh `Test.createTestingModule(...).compile()`, not on a later
`process.env` mutation against an already-running app).

**9. `AuthService` has no unit-test file, by existing convention — the new
`loginWithOidc` logic is covered by the e2e spec instead of a new mocked
unit test.** `register`/`login`/`refresh`/`logout` were already only
covered by `test/auth.e2e-spec.ts` against a real DB, not by mocked-DB unit
tests; `loginWithOidc` follows the same pattern rather than introducing a
new, inconsistent testing style for one method. `OidcService` (pure JWKS/
HTTP logic, no DB) gets a real unit spec (`oidc.service.spec.ts`,
`jest.mock("jose")` + mocked `fetch`), matching how `StripePaymentProvider`/
`OpenSearchSearchProvider`/`TemporalDunningOrchestrator` are unit-tested.

**10. Not built this phase**: JIT user auto-provisioning; OIDC logout/SLO
propagation back to Keycloak; multiple simultaneous OIDC providers/realms;
replacing password login entirely; SCIM/user-sync; mapping Keycloak realm
roles to local permissions (permissions still come entirely from local RBAC
tables — Keycloak is authentication only, never authorization, this
phase). Each is a reasonable, separable future increment, recorded here
rather than silently gapped.

## Consequences

- A real, opt-in "Sign in with SSO" path now exists end-to-end (Keycloak
  container → `apps/api`'s `POST /auth/oidc/token` → `apps/web`'s BFF
  routes → httpOnly cookies), but password login remains the only *required*
  path and the only one enabled by default.
- The `resolveLoginCandidate`/`completeLogin` extraction is a reusable seam:
  any future third credential method (e.g. a second OIDC realm, WebAuthn)
  plugs into the same two functions rather than duplicating login's tail.
- The `jose` v4-vs-v6 CJS/ESM incompatibility is a durable note for this
  codebase: any future pure-ESM-only dependency will hit the identical
  `ts-jest`/CommonJS wall until the project's Jest config itself is
  upgraded for ESM — worth remembering before adding another modern,
  ESM-only package.
- Keycloak is now running in the local/dev topology (`docker-compose.yml`),
  alongside RabbitMQ/OpenSearch/Temporal, as real prerequisite
  infrastructure for the eventual microservices split.
- The microservices split is the last of the five originally-deferred
  items.
