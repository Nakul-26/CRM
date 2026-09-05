import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { jwtVerify } from "jose";
import type { ApiEnv } from "@sales-platform/config";
import { OidcService } from "./oidc.service";

jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn().mockReturnValue("mock-jwks"),
  jwtVerify: jest.fn(),
}));

function makeConfig(values: Partial<Record<string, unknown>>) {
  return { get: (key: string) => values[key] } as unknown as ConfigService<ApiEnv, true>;
}

const enabledConfig = {
  AUTH_OIDC_ENABLED: true,
  OIDC_ISSUER_URL: "http://localhost:8082/realms/sales-platform",
  OIDC_CLIENT_ID: "sales-platform-api",
  OIDC_CLIENT_SECRET: "dev-oidc-client-secret-change-me",
};

describe("OidcService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("verifyIdToken", () => {
    it("returns the token's claims once jose confirms signature/issuer/audience", async () => {
      (jwtVerify as jest.Mock).mockResolvedValue({
        payload: { sub: "kc-user-1", email: "sso@example.com", email_verified: true },
      });

      const service = new OidcService(makeConfig(enabledConfig));
      const claims = await service.verifyIdToken("a.b.c");

      expect(claims).toMatchObject({ email: "sso@example.com", email_verified: true });
      expect(jwtVerify).toHaveBeenCalledWith(
        "a.b.c",
        "mock-jwks",
        expect.objectContaining({ issuer: enabledConfig.OIDC_ISSUER_URL, audience: enabledConfig.OIDC_CLIENT_ID }),
      );
    });

    it("rejects with INVALID_CREDENTIALS when jose rejects the token (bad signature, wrong issuer/audience, expired, ...)", async () => {
      (jwtVerify as jest.Mock).mockRejectedValue(new Error("signature verification failed"));

      const service = new OidcService(makeConfig(enabledConfig));
      await expect(service.verifyIdToken("a.b.c")).rejects.toThrow(UnauthorizedException);
    });

    it("throws (does not silently no-op) when AUTH_OIDC_ENABLED is false", async () => {
      const service = new OidcService(makeConfig({ AUTH_OIDC_ENABLED: false }));
      await expect(service.verifyIdToken("a.b.c")).rejects.toThrow(UnauthorizedException);
      expect(jwtVerify).not.toHaveBeenCalled();
    });

    it("throws a configuration error when enabled but missing OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET", async () => {
      const service = new OidcService(makeConfig({ AUTH_OIDC_ENABLED: true }));
      await expect(service.verifyIdToken("a.b.c")).rejects.toThrow(/OIDC_ISSUER_URL/);
    });
  });

  describe("exchangeCodeForIdToken", () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("posts the code to Keycloak's token endpoint and returns the id_token", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id_token: "the-id-token", access_token: "the-access-token" }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const service = new OidcService(makeConfig(enabledConfig));
      const idToken = await service.exchangeCodeForIdToken("auth-code", "http://localhost:3000/api/auth/oidc/callback");

      expect(idToken).toBe("the-id-token");
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${enabledConfig.OIDC_ISSUER_URL}/protocol/openid-connect/token`);
      const body = new URLSearchParams(init.body as string);
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("client_secret")).toBe(enabledConfig.OIDC_CLIENT_SECRET);
    });

    it("rejects with INVALID_CREDENTIALS when Keycloak rejects the code", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "invalid_grant" }) as unknown as typeof fetch;

      const service = new OidcService(makeConfig(enabledConfig));
      await expect(service.exchangeCodeForIdToken("bad-code", "http://localhost:3000/callback")).rejects.toThrow(UnauthorizedException);
    });
  });
});
