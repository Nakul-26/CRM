import { Client } from "@opensearch-project/opensearch";
import postgres from "postgres";
import { SEARCH_INDEX, ensureSearchIndex } from "../modules/crm/search/providers/opensearch-search.provider";

/**
 * Standalone backfill for the OpenSearch search index (mirrors migrate.ts's
 * style — no Nest DI, connects directly). Needed because switching
 * SEARCH_PROVIDER=opensearch on an existing database starts from an empty
 * index; SearchIndexListener only keeps it in sync going forward. See
 * docs/decisions/0015-opensearch-phase15-scope.md.
 */
export async function reindexSearch(databaseUrl: string, opensearchUrl: string): Promise<number> {
  const sql = postgres(databaseUrl, { max: 1 });
  const client = new Client({ node: opensearchUrl });
  let indexed = 0;

  try {
    await ensureSearchIndex(client);

    const accountRows = await sql`SELECT id, organization_id, name FROM crm.accounts WHERE deleted_at IS NULL`;
    for (const row of accountRows) {
      await client.index({
        index: SEARCH_INDEX,
        id: `account:${row.id}`,
        body: { type: "account", entityId: row.id, organizationId: row.organization_id, label: row.name },
        refresh: "wait_for",
      });
      indexed++;
    }

    const contactRows = await sql`SELECT id, organization_id, first_name, last_name, email FROM crm.contacts WHERE deleted_at IS NULL`;
    for (const row of contactRows) {
      await client.index({
        index: SEARCH_INDEX,
        id: `contact:${row.id}`,
        body: {
          type: "contact",
          entityId: row.id,
          organizationId: row.organization_id,
          label: `${row.first_name} ${row.last_name}`,
          subLabel: row.email ?? undefined,
        },
        refresh: "wait_for",
      });
      indexed++;
    }

    const leadRows = await sql`SELECT id, organization_id, name, company FROM leads.leads WHERE deleted_at IS NULL`;
    for (const row of leadRows) {
      await client.index({
        index: SEARCH_INDEX,
        id: `lead:${row.id}`,
        body: {
          type: "lead",
          entityId: row.id,
          organizationId: row.organization_id,
          label: row.name,
          subLabel: row.company ?? undefined,
        },
        refresh: "wait_for",
      });
      indexed++;
    }
  } finally {
    await sql.end();
  }

  return indexed;
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv/config");
  const databaseUrl = process.env.DATABASE_URL;
  const opensearchUrl = process.env.OPENSEARCH_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  if (!opensearchUrl) throw new Error("OPENSEARCH_URL is not set");

  console.log("Reindexing search documents into OpenSearch...");
  reindexSearch(databaseUrl, opensearchUrl)
    .then((count) => console.log(`Reindexed ${count} documents.`))
    .catch((error) => {
      console.error("Reindex failed:", error);
      process.exit(1);
    });
}
