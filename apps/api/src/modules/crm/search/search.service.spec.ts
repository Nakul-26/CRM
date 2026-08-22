import type { SearchResultDto } from "@sales-platform/contracts";
import { SearchService } from "./search.service";
import type { PostgresSearchProvider } from "./providers/postgres-search.provider";
import type { SearchProvider } from "./providers/search-provider.interface";

const sampleResults: SearchResultDto[] = [{ id: "acc_1", type: "account", label: "Acme", rank: 1 }];

describe("SearchService", () => {
  it("delegates to the active provider (postgres, default)", async () => {
    const provider = { kind: "postgres", search: jest.fn().mockResolvedValue(sampleResults) } as unknown as SearchProvider;
    const postgresFallback = { search: jest.fn() } as unknown as PostgresSearchProvider;
    const service = new SearchService(provider, postgresFallback);

    const result = await service.search("org_1", "acme", { limit: 10 });

    expect(result).toBe(sampleResults);
    expect(postgresFallback.search).not.toHaveBeenCalled();
  });

  it("rethrows if the Postgres provider itself fails (nothing left to fall back to)", async () => {
    const provider = { kind: "postgres", search: jest.fn().mockRejectedValue(new Error("db down")) } as unknown as SearchProvider;
    const postgresFallback = { search: jest.fn() } as unknown as PostgresSearchProvider;
    const service = new SearchService(provider, postgresFallback);

    await expect(service.search("org_1", "acme", {})).rejects.toThrow("db down");
  });

  it("falls back to Postgres when the OpenSearch provider fails", async () => {
    const provider = { kind: "opensearch", search: jest.fn().mockRejectedValue(new Error("cluster unavailable")) } as unknown as SearchProvider;
    const postgresFallback = { search: jest.fn().mockResolvedValue(sampleResults) } as unknown as PostgresSearchProvider;
    const service = new SearchService(provider, postgresFallback);

    const result = await service.search("org_1", "acme", { limit: 5 });

    expect(result).toBe(sampleResults);
    expect(postgresFallback.search).toHaveBeenCalledWith("org_1", "acme", { limit: 5 });
  });

  it("does not fall back when the OpenSearch provider succeeds", async () => {
    const provider = { kind: "opensearch", search: jest.fn().mockResolvedValue(sampleResults) } as unknown as SearchProvider;
    const postgresFallback = { search: jest.fn() } as unknown as PostgresSearchProvider;
    const service = new SearchService(provider, postgresFallback);

    await service.search("org_1", "acme", {});

    expect(postgresFallback.search).not.toHaveBeenCalled();
  });
});
