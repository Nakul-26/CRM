import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { ApiEnv } from "@sales-platform/config";
import type { AuthenticatedUser } from "@sales-platform/contracts";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { RequestContextService } from "../context/request-context";

export interface AccessTokenClaims {
  sub: string;
  organizationId: string;
  email: string;
  fullName: string;
  permissions: string[];
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<ApiEnv, true>,
    private readonly reflector: Reflector,
    private readonly context: RequestContextService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

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
    this.context.setAuth({
      userId: user.id,
      organizationId: user.organizationId,
      permissions: user.permissions,
    });

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
