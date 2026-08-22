import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client } from "@opensearch-project/opensearch";
import type { ApiEnv } from "@sales-platform/config";
import type { SearchResultDto } from "@sales-platform/contracts";
import type { SearchEntityType, SearchOptions, SearchProvider } from "./search-provider.interface";

export const SEARCH_INDEX = "crm-search";

export interface SearchIndexDocument {
  type: SearchEntityType;
  entityId: string;
  organizationId: string;
  label: string;
  subLabel?: string;
}

interface OpenSearchHit {
  _score?: number;
  _source: SearchIndexDocument;
}

interface OpenSearchSearchResponseBody {
  hits: { hits: OpenSearchHit[] };
}

/**
 * Creates the index with an explicit mapping if it doesn't already exist —
 * without this, OpenSearch's dynamic mapping infers `organizationId`/`type`/
 * `entityId` as analyzed `text` fields, and a `term` filter against an
 * analyzed field silently matches nothing (no error, just an empty result)
 * since the indexed tokens aren't the exact original string. `label`/
 * `subLabel` stay `text` — those are the fields multi_match/fuzziness
 * search over. Exported so both OpenSearchSearchProvider and the standalone
 * reindex-search.ts script share one mapping definition.
 */
export async function ensureSearchIndex(client: Client): Promise<void> {
  const { body: exists } = await client.indices.exists({ index: SEARCH_INDEX });
  if (exists) return;
  try {
    await client.indices.create({
      index: SEARCH_INDEX,
      body: {
        settings: { number_of_replicas: 0 },
        mappings: {
          properties: {
            type: { type: "keyword" },
            entityId: { type: "keyword" },
            organizationId: { type: "keyword" },
            label: { type: "text" },
            subLabel: { type: "text" },
          },
        },
      },
    });
  } catch (error) {
    // Lost a race with another concurrent caller creating the same index.
    const type = (error as { body?: { error?: { type?: string } } }).body?.error?.type;
    if (type !== "resource_already_exists_exception") throw error;
  }
}

/**
 * Real OpenSearch integration, opt-in via SEARCH_PROVIDER=opensearch. The
 * client is built lazily (not in the constructor) so this class can always
 * be registered for DI without breaking app startup when running with the
 * default Postgres provider and no OPENSEARCH_URL configured at all — same
 * idiom as StripePaymentProvider/RabbitMQAuditTransport. See
 * docs/decisions/0015-opensearch-phase15-scope.md.
 */
@Injectable()
export class OpenSearchSearchProvider implements SearchProvider {
  readonly kind = "opensearch" as const;

  private readonly logger = new Logger(OpenSearchSearchProvider.name);
  private client: Client | undefined;
  private indexEnsured: Promise<void> | undefined;

  constructor(private readonly config: ConfigService<ApiEnv, true>) {}

  async search(organizationId: string, q: string, options: SearchOptions = {}): Promise<SearchResultDto[]> {
    await this.ensureIndex();
    const types = options.types ?? (["account", "contact"] as SearchEntityType[]);
    const limit = options.limit ?? 20;

    const response = await this.getClient().search({
      index: SEARCH_INDEX,
      body: {
        size: limit,
        query: {
          bool: {
            must: [{ multi_match: { query: q, fields: ["label^2", "subLabel"], fuzziness: "AUTO" } }],
            filter: [{ term: { organizationId } }, { terms: { type: types } }],
          },
        },
      },
    });

    const body = response.body as unknown as OpenSearchSearchResponseBody;
    return body.hits.hits.map((hit) => ({
      id: hit._source.entityId,
      type: hit._source.type,
      label: hit._source.label,
      subLabel: hit._source.subLabel,
      rank: hit._score ?? 0,
    }));
  }

  async indexDocument(doc: SearchIndexDocument): Promise<void> {
    await this.ensureIndex();
    await this.getClient().index({
      index: SEARCH_INDEX,
      id: `${doc.type}:${doc.entityId}`,
      body: doc,
      refresh: "wait_for",
    });
  }

  async deleteDocument(type: SearchEntityType, entityId: string): Promise<void> {
    try {
      await this.getClient().delete({
        index: SEARCH_INDEX,
        id: `${type}:${entityId}`,
        refresh: "wait_for",
      });
    } catch (error) {
      // 404 (document never indexed, e.g. deleted before the provider was
      // ever switched on) is not a failure worth logging.
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode !== 404) {
        this.logger.error(`Failed to delete search document "${type}:${entityId}" from OpenSearch`, error as Error);
      }
    }
  }

  private async ensureIndex(): Promise<void> {
    if (!this.indexEnsured) {
      this.indexEnsured = ensureSearchIndex(this.getClient());
    }
    return this.indexEnsured;
  }

  private getClient(): Client {
    if (this.client) return this.client;
    const node = this.config.get("OPENSEARCH_URL", { infer: true });
    if (!node) {
      throw new Error("SEARCH_PROVIDER=opensearch requires OPENSEARCH_URL to be set");
    }
    this.client = new Client({ node });
    return this.client;
  }
}
