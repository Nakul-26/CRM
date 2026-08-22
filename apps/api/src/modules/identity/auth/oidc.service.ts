import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { ApiEnv } from "@sales-platform/config";
import { ERROR_CODES } from "@sales-platform/contracts";

export interface OidcIdTokenClaims extends JWTPayload {
  email?: string;
  email_verified?: boolean;
}

interface TokenResponse {
  id_token: string;
  access_token: string;
}

/**
 * Pure OIDC transport plumbing — no local-user/RBAC knowledge lives here
 * (see AuthService.loginWithOidc for that). Only ever touched when
 * AUTH_OIDC_ENABLED=true; the JWKS client is built lazily on first use so
 * the default password-only login path never requires OIDC_* to be set or
 * Keycloak to be reachable, including at app boot. See
 * docs/decisions/0017-keycloak-oidc-phase17-scope.md.
 */
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

  constructor(private readonly config: ConfigService<ApiEnv, true>) {}

  /** Exchanges an authorization code for tokens directly with Keycloak (server-to-server, confidential client). */
  async exchangeCodeForIdToken(code: string, redirectUri: string): Promise<string> {
    const { issuerUrl, clientId, clientSecret } = this.getConfig();

    const response = await fetch(`${issuerUrl}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.warn(`Keycloak token exchange failed: ${response.status} ${body}`);
      throw new UnauthorizedException({ code: ERROR_CODES.INVALID_CREDENTIALS, message: "OIDC code exchange failed" });
    }

    const data = (await response.json()) as TokenResponse;
    return data.id_token;
  }

  /** Verifies signature, issuer, and audience against our configured Keycloak realm's JWKS. */
  async verifyIdToken(idToken: string): Promise<OidcIdTokenClaims> {
    const { issuerUrl, clientId } = this.getConfig();

    try {
      const { payload } = await jwtVerify(idToken, this.getJwks(issuerUrl), {
        issuer: issuerUrl,
        audience: clientId,
      });
      return payload as OidcIdTokenClaims;
    } catch (error) {
      this.logger.warn("OIDC ID token verification failed", error as Error);
      throw new UnauthorizedException({ code: ERROR_CODES.INVALID_CREDENTIALS, message: "Invalid OIDC token" });
    }
  }

  private getJwks(issuerUrl: string): ReturnType<typeof createRemoteJWKSet> {
    if (this.jwks) return this.jwks;
    this.jwks = createRemoteJWKSet(new URL(`${issuerUrl}/protocol/openid-connect/certs`));
    return this.jwks;
  }

  private getConfig(): { issuerUrl: string; clientId: string; clientSecret: string } {
    if (!this.config.get("AUTH_OIDC_ENABLED", { infer: true })) {
      throw new UnauthorizedException({ code: ERROR_CODES.INVALID_CREDENTIALS, message: "OIDC login is not enabled" });
    }
    const issuerUrl = this.config.get("OIDC_ISSUER_URL", { infer: true });
    const clientId = this.config.get("OIDC_CLIENT_ID", { infer: true });
    const clientSecret = this.config.get("OIDC_CLIENT_SECRET", { infer: true });
    if (!issuerUrl || !clientId || !clientSecret) {
      throw new Error("AUTH_OIDC_ENABLED=true requires OIDC_ISSUER_URL, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET to be set");
    }
    return { issuerUrl, clientId, clientSecret };
  }
}
