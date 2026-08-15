import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";

/**
 * Populated in two stages:
 *  1. RequestContextMiddleware sets requestId/correlationId/ip/userAgent for
 *     every request, before any guard runs.
 *  2. JwtAuthGuard sets organizationId/userId/permissions once the token is
 *     verified.
 *
 * This is the ONLY place organizationId/userId/permissions come from for
 * authorization and repository queries — never the request body, params, or
 * query string. See docs/architecture/overview.md#multi-tenancy--auth.
 */
export interface RequestContextStore {
  requestId: string;
  correlationId: string;
  ip?: string;
  userAgent?: string;
  organizationId?: string;
  userId?: string;
  permissions?: string[];
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextStore>();

  run<T>(initial: RequestContextStore, callback: () => T): T {
    return this.storage.run(initial, callback);
  }

  get(): RequestContextStore {
    const store = this.storage.getStore();
    if (!store) {
      throw new Error(
        "RequestContextService.get() called outside of a request. Is RequestContextMiddleware registered?",
      );
    }
    return store;
  }

  getOrNull(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  setAuth(fields: Pick<RequestContextStore, "organizationId" | "userId" | "permissions">): void {
    Object.assign(this.get(), fields);
  }

  /** Throws if called before auth context is populated — fail closed, not open. */
  requireOrganizationId(): string {
    const { organizationId } = this.get();
    if (!organizationId) {
      throw new Error("No organizationId in request context — is this route behind JwtAuthGuard?");
    }
    return organizationId;
  }

  requireUserId(): string {
    const { userId } = this.get();
    if (!userId) {
      throw new Error("No userId in request context — is this route behind JwtAuthGuard?");
    }
    return userId;
  }
}
