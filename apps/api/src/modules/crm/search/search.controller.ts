import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "@sales-platform/contracts";
import { CurrentUser } from "../../../shared/decorators/current-user.decorator";
import { SearchService } from "./search.service";

@ApiTags("search")
@Controller("search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Query("q") q: string, @Query("types") types?: string, @Query("limit") limit?: string) {
    if (!q?.trim()) return [];

    const requested = types ? (types.split(",") as ("account" | "contact")[]) : (["account", "contact"] as const);
    // A caller without crm.accounts.view / crm.contacts.view is silently
    // excluded from that type rather than 403ing the whole search — a
    // Member who can see contacts but not accounts should still get
    // contact results back.
    const allowed = requested.filter(
      (type) =>
        (type === "account" && user.permissions.includes("crm.accounts.view")) ||
        (type === "contact" && user.permissions.includes("crm.contacts.view")),
    );
    if (allowed.length === 0) return [];

    return this.search.search(user.organizationId, q, {
      types: allowed,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
