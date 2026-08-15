import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission } from "@sales-platform/contracts";
import { PERMISSIONS_KEY } from "../decorators/require-permissions.decorator";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) {
      // Authenticated (JwtAuthGuard already ran) but no specific
      // permission declared — allow. Routes that need restriction must
      // declare it explicitly via @RequirePermissions(...).
      return true;
    }

    const request = ctx.switchToHttp().getRequest();
    const granted: string[] = request.user?.permissions ?? [];
    const hasAll = required.every((permission) => granted.includes(permission));

    if (!hasAll) {
      throw new ForbiddenException(
        `Missing required permission(s): ${required.filter((p) => !granted.includes(p)).join(", ")}`,
      );
    }

    return true;
  }
}
