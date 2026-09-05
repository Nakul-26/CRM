import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type { NotificationsServiceEnv } from "@sales-platform/config";
import type { AuthenticatedUser } from "@sales-platform/contracts";

interface AccessTokenClaims {
  sub: string;
  organizationId: string;
  email: string;
  fullName: string;
  permissions: string[];
}

/**
 * A trimmed, local copy of apps/api's JwtAuthGuard
 * (apps/api/src/shared/guards/jwt-auth.guard.ts) — verifies the exact same
 * access token (same JWT_ACCESS_SECRET, same claim shape) that apps/api's
 * AuthService issues; this service never issues its own tokens, so there's
 * no `@Public()` escape hatch here (unlike apps/api's guard) — every route
 * in this service requires a valid token. See
 * docs/decisions/0018-microservices-split-phase18-scope.md for why this is
 * a small local copy rather than a new shared package: the only surface
 * needed is "verify a token issued elsewhere," not the full guard/decorator
 * set apps/api's 26 controllers use (@RequirePermissions, @Public, etc.),
 * none of which NotificationsController ever used either.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<NotificationsServiceEnv, true>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwtService.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }

    const user: AuthenticatedUser = {
      id: claims.sub,
      organizationId: claims.organizationId,
      email: claims.email,
      fullName: claims.fullName,
      permissions: claims.permissions,
    };

    request.user = user;
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return undefined;
    }
    return header.slice("Bearer ".length);
  }
}
