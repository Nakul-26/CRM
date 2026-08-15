import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { SearchResultDto } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";

export interface SearchOptions {
  types?: ("account" | "contact")[];
  limit?: number;
}

interface AccountSearchRow {
  id: string;
  label: string;
  rank: number;
}

interface ContactSearchRow {
  id: string;
  label: string;
  sub_label: string | null;
  rank: number;
}

@Injectable()
export class SearchService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  /**
   * Postgres tsvector + GIN search (see the generated `search_vector`
   * columns on crm.accounts/crm.contacts). Drizzle's query builder has no
   * `@@`/`tsquery` operator support, so this is the one deliberate raw-SQL
   * escape hatch in an otherwise query-builder codebase.
   */
  async search(organizationId: string, q: string, options: SearchOptions = {}): Promise<SearchResultDto[]> {
    const limit = options.limit ?? 20;
    const wantAccounts = !options.types || options.types.includes("account");
    const wantContacts = !options.types || options.types.includes("contact");

    const queries: Promise<SearchResultDto[]>[] = [];

    if (wantAccounts) {
      queries.push(
        this.db
          .execute(sql`
            SELECT id, name AS label, ts_rank(search_vector, query) AS rank
            FROM crm.accounts, plainto_tsquery('english', ${q}) query
            WHERE search_vector @@ query AND organization_id = ${organizationId} AND deleted_at IS NULL
            ORDER BY rank DESC
            LIMIT ${limit}
          `)
          .then((rows) =>
            (rows as unknown as AccountSearchRow[]).map((r) => ({
              id: r.id,
              type: "account" as const,
              label: r.label,
              rank: Number(r.rank),
            })),
          ),
      );
    }

    if (wantContacts) {
      queries.push(
        this.db
          .execute(sql`
            SELECT id, (first_name || ' ' || last_name) AS label, email AS sub_label, ts_rank(search_vector, query) AS rank
            FROM crm.contacts, plainto_tsquery('english', ${q}) query
            WHERE search_vector @@ query AND organization_id = ${organizationId} AND deleted_at IS NULL
            ORDER BY rank DESC
            LIMIT ${limit}
          `)
          .then((rows) =>
            (rows as unknown as ContactSearchRow[]).map((r) => ({
              id: r.id,
              type: "contact" as const,
              label: r.label,
              subLabel: r.sub_label ?? undefined,
              rank: Number(r.rank),
            })),
          ),
      );
    }

    const results = (await Promise.all(queries)).flat();
    results.sort((a, b) => b.rank - a.rank);
    return results.slice(0, limit);
  }
}
