import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { JwtAuthGuard } from "./jwt-auth.guard";

function makeContext(headers: Record<string, string>) {
  const request: { headers: Record<string, string>; user?: unknown } = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext & { __request: typeof request };
}

describe("JwtAuthGuard", () => {
  const config = { get: () => "test-secret" } as unknown as ConfigService<never, true>;

  it("throws UnauthorizedException when no Authorization header is present", async () => {
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const guard = new JwtAuthGuard(jwtService, config);

    await expect(guard.canActivate(makeContext({}))).rejects.toThrow(UnauthorizedException);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedException when the header isn't a Bearer token", async () => {
    const jwtService = { verifyAsync: jest.fn() } as unknown as JwtService;
    const guard = new JwtAuthGuard(jwtService, config);

    await expect(guard.canActivate(makeContext({ authorization: "Basic abc123" }))).rejects.toThrow(UnauthorizedException);
  });

  it("throws UnauthorizedException when verification fails (invalid/expired token)", async () => {
    const jwtService = { verifyAsync: jest.fn().mockRejectedValue(new Error("bad signature")) } as unknown as JwtService;
    const guard = new JwtAuthGuard(jwtService, config);

    await expect(guard.canActivate(makeContext({ authorization: "Bearer bad.token.here" }))).rejects.toThrow(UnauthorizedException);
  });

  it("sets request.user from the verified claims and returns true on success", async () => {
    const claims = { sub: "user_1", organizationId: "org_1", email: "a@b.com", fullName: "A B", permissions: ["x"] };
    const jwtService = { verifyAsync: jest.fn().mockResolvedValue(claims) } as unknown as JwtService;
    const guard = new JwtAuthGuard(jwtService, config);
    const ctx = makeContext({ authorization: "Bearer good.token.here" });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const request = ctx.switchToHttp().getRequest() as { user?: unknown };
    expect(request.user).toEqual({
      id: "user_1",
      organizationId: "org_1",
      email: "a@b.com",
      fullName: "A B",
      permissions: ["x"],
    });
  });
});
