import type { SearchResultDto } from "@sales-platform/contracts";

export type SearchEntityType = "account" | "contact" | "lead";

export interface SearchOptions {
  types?: SearchEntityType[];
  limit?: number;
}

export interface SearchProvider {
  readonly kind: "postgres" | "opensearch";
  search(organizationId: string, q: string, options: SearchOptions): Promise<SearchResultDto[]>;
}

export const SEARCH_PROVIDER = Symbol("SEARCH_PROVIDER");
