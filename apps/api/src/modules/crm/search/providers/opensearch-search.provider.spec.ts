import { ConfigService } from "@nestjs/config";
import { Client } from "@opensearch-project/opensearch";
import { OpenSearchSearchProvider, ensureSearchIndex } from "./opensearch-search.provider";

jest.mock("@opensearch-project/opensearch");

function makeConfig(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] } as unknown as ConfigService<never, true>;
}

function makeMockClient() {
  return {
    search: jest.fn(),
    index: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    indices: {
      exists: jest.fn().mockResolvedValue({ body: true }),
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

describe("OpenSearchSearchProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("search", () => {
    it("builds a multi_match query filtered by organization and type, and maps hits", async () => {
      const client = makeMockClient();
      client.search.mockResolvedValue({
        body: {
          hits: {
            hits: [
              { _score: 4.2, _source: { type: "account", entityId: "acc_1", organizationId: "org_1", label: "Acme Inc" } },
              { _score: 1.1, _source: { type: "contact", entityId: "con_1", organizationId: "org_1", label: "Jane Doe", subLabel: "jane@acme.com" } },
            ],
          },
        },
      });
      (Client as unknown as jest.Mock).mockImplementation(() => client);

      const provider = new OpenSearchSearchProvider(makeConfig({ OPENSEARCH_URL: "http://localhost:9201" }));
      const results = await provider.search("org_1", "acme", { types: ["account", "contact"], limit: 10 });

      expect(client.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index: "crm-search",
          body: expect.objectContaining({
            size: 10,
            query: expect.objectContaining({
              bool: expect.objectContaining({
                must: [expect.objectContaining({ multi_match: expect.objectContaining({ query: "acme", fuzziness: "AUTO" }) })],
                filter: expect.arrayContaining([
                  { term: { organizationId: "org_1" } },
                  { terms: { type: ["account", "contact"] } },
                ]),
              }),
            }),
          }),
        }),
      );
      expect(results).toEqual([
        { id: "acc_1", type: "account", label: "Acme Inc", subLabel: undefined, rank: 4.2 },
        { id: "con_1", type: "contact", label: "Jane Doe", subLabel: "jane@acme.com", rank: 1.1 },
      ]);
    });

    it("throws (does not swallow) when OPENSEARCH_URL is not configured — SearchService is responsible for the fallback", async () => {
      const provider = new OpenSearchSearchProvider(makeConfig({}));
      await expect(provider.search("org_1", "acme", {})).rejects.toThrow(/OPENSEARCH_URL/);
    });
  });

  describe("ensureSearchIndex", () => {
    it("creates the index with keyword-mapped filter fields when it doesn't exist", async () => {
      const client = makeMockClient();
      client.indices.exists.mockResolvedValue({ body: false });

      await ensureSearchIndex(client as never);

      expect(client.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          index: "crm-search",
          body: expect.objectContaining({
            mappings: {
              properties: {
                type: { type: "keyword" },
                entityId: { type: "keyword" },
                organizationId: { type: "keyword" },
                label: { type: "text" },
                subLabel: { type: "text" },
              },
            },
          }),
        }),
      );
    });

    it("does nothing if the index already exists", async () => {
      const client = makeMockClient();
      client.indices.exists.mockResolvedValue({ body: true });

      await ensureSearchIndex(client as never);

      expect(client.indices.create).not.toHaveBeenCalled();
    });

    it("ignores a resource_already_exists_exception race", async () => {
      const client = makeMockClient();
      client.indices.exists.mockResolvedValue({ body: false });
      client.indices.create.mockRejectedValue({ body: { error: { type: "resource_already_exists_exception" } } });

      await expect(ensureSearchIndex(client as never)).resolves.toBeUndefined();
    });
  });

  describe("indexDocument / deleteDocument", () => {
    it("indexes with a composite id and wait_for refresh", async () => {
      const client = makeMockClient();
      (Client as unknown as jest.Mock).mockImplementation(() => client);

      const provider = new OpenSearchSearchProvider(makeConfig({ OPENSEARCH_URL: "http://localhost:9201" }));
      await provider.indexDocument({ type: "lead", entityId: "lead_1", organizationId: "org_1", label: "Big Co" });

      expect(client.index).toHaveBeenCalledWith(
        expect.objectContaining({
          index: "crm-search",
          id: "lead:lead_1",
          body: { type: "lead", entityId: "lead_1", organizationId: "org_1", label: "Big Co" },
          refresh: "wait_for",
        }),
      );
    });

    it("deletes by composite id and swallows a 404 (never-indexed document)", async () => {
      const client = makeMockClient();
      client.delete.mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 }));
      (Client as unknown as jest.Mock).mockImplementation(() => client);

      const provider = new OpenSearchSearchProvider(makeConfig({ OPENSEARCH_URL: "http://localhost:9201" }));
      await expect(provider.deleteDocument("account", "acc_missing")).resolves.toBeUndefined();
      expect(client.delete).toHaveBeenCalledWith(expect.objectContaining({ index: "crm-search", id: "account:acc_missing" }));
    });

    it("swallows non-404 delete errors too (logs, never throws)", async () => {
      const client = makeMockClient();
      client.delete.mockRejectedValue(new Error("cluster unavailable"));
      (Client as unknown as jest.Mock).mockImplementation(() => client);

      const provider = new OpenSearchSearchProvider(makeConfig({ OPENSEARCH_URL: "http://localhost:9201" }));
      await expect(provider.deleteDocument("account", "acc_1")).resolves.toBeUndefined();
    });
  });
});
