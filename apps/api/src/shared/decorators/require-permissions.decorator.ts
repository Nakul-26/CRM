import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@sales-platform/contracts";

export const PERMISSIONS_KEY = "permissions";

/** Section 19: authorize on permission strings, never on role names. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
