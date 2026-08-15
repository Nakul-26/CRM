import { ForbiddenException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { PermissionsGuard } from "./permissions.guard";

function makeContext(user: { permissions: string[] } | undefined) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function makeReflector(overrides: { isPublic?: boolean; required?: string[] }) {
  return {
    getAllAndOverride: (key: string) => {
      if (key === "isPublic") return overrides.isPublic;
      if (key === "permissions") return overrides.required;
      return undefined;
    },
  } as unknown as Reflector;
}

describe("PermissionsGuard", () => {
  it("allows public routes without checking permissions", () => {
    const guard = new PermissionsGuard(makeReflector({ isPublic: true }));
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it("allows authenticated routes with no declared permission requirement", () => {
    const guard = new PermissionsGuard(makeReflector({ required: [] }));
    expect(guard.canActivate(makeContext({ permissions: [] }))).toBe(true);
  });

  it("allows a user who holds every required permission", () => {
    const guard = new PermissionsGuard(makeReflector({ required: ["identity.users.invite"] }));
    expect(guard.canActivate(makeContext({ permissions: ["identity.users.invite", "identity.users.view"] }))).toBe(true);
  });

  it("denies a user missing a required permission (permission-based, not role-name-based)", () => {
    const guard = new PermissionsGuard(makeReflector({ required: ["identity.users.invite"] }));
    expect(() => guard.canActivate(makeContext({ permissions: ["identity.users.view"] }))).toThrow(ForbiddenException);
  });

  it("denies when the user object is entirely absent", () => {
    const guard = new PermissionsGuard(makeReflector({ required: ["identity.users.invite"] }));
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});
