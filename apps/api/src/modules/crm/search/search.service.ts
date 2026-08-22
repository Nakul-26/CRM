import { Inject, Injectable, Logger } from "@nestjs/common";
import type { SearchResultDto } from "@sales-platform/contracts";
import { PostgresSearchProvider } from "./providers/postgres-search.provider";
import { SEARCH_PROVIDER, type SearchOptions, type SearchProvider } from "./providers/search-provider.interface";

/**
 * Thin delegate to the active SEARCH_PROVIDER (see search-provider.interface.ts
 * and docs/decisions/0015-opensearch-phase15-scope.md). If the active
 * provider is opensearch and a query fails for any reason, falls back to
 * Postgres for that request rather than failing it — Postgres is always
 * live authoritative data, so this is a strictly safe degradation, unlike
 * a write path with state to lose.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @Inject(SEARCH_PROVIDER) private readonly provider: SearchProvider,
    private readonly postgresFallback: PostgresSearchProvider,
  ) {}

  async search(organizationId: string, q: string, options: SearchOptions = {}): Promise<SearchResultDto[]> {
    try {
      return await this.provider.search(organizationId, q, options);
    } catch (error) {
      if (this.provider.kind === "postgres") throw error;
      this.logger.error("Search provider failed, falling back to Postgres", error as Error);
      return this.postgresFallback.search(organizationId, q, options);
    }
  }
}
