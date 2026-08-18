import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { SearchResultDto } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";

export interface SearchOptions {
  types?: ("account" | "contact" | "lead")[];
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

interface LeadSearchRow {
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
   * columns on crm.accounts/crm.contacts/leads.leads), blended with a
   * `pg_trgm` similarity score for typo-tolerant matching (Phase 8
   * "Advanced search" — see docs/decisions/0008-analytics-automation-phase8-scope.md).
   * A row matches if either the full-text query or the trigram similarity
   * operator (`%`) hits; ranked by whichever score is higher. Drizzle's
   * query builder has no `@@`/`tsquery`/`%` operator support, so this stays
   * the one deliberate raw-SQL escape hatch in an otherwise query-builder
   * codebase.
   */
  async search(organizationId: string, q: string, options: SearchOptions = {}): Promise<SearchResultDto[]> {
    const limit = options.limit ?? 20;
    const wantAccounts = !options.types || options.types.includes("account");
    const wantContacts = !options.types || options.types.includes("contact");
    const wantLeads = options.types?.includes("lead") ?? false;

    const queries: Promise<SearchResultDto[]>[] = [];

    if (wantAccounts) {
      queries.push(
        this.db
          .execute(sql`
            SELECT id, name AS label,
              GREATEST(ts_rank(search_vector, plainto_tsquery('english', ${q})), similarity(name, ${q})) AS rank
            FROM crm.accounts, plainto_tsquery('english', ${q}) query
            WHERE (search_vector @@ query OR name % ${q})
              AND organization_id = ${organizationId} AND deleted_at IS NULL
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
            SELECT id, (first_name || ' ' || last_name) AS label, email AS sub_label,
              GREATEST(ts_rank(search_vector, plainto_tsquery('english', ${q})), similarity(first_name || ' ' || last_name, ${q})) AS rank
            FROM crm.contacts, plainto_tsquery('english', ${q}) query
            WHERE (search_vector @@ query OR (first_name || ' ' || last_name) % ${q})
              AND organization_id = ${organizationId} AND deleted_at IS NULL
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

    if (wantLeads) {
      queries.push(
        this.db
          .execute(sql`
            SELECT id, name AS label, company AS sub_label,
              GREATEST(ts_rank(search_vector, plainto_tsquery('english', ${q})), similarity(name, ${q})) AS rank
            FROM leads.leads, plainto_tsquery('english', ${q}) query
            WHERE (search_vector @@ query OR name % ${q})
              AND organization_id = ${organizationId} AND deleted_at IS NULL
            ORDER BY rank DESC
            LIMIT ${limit}
          `)
          .then((rows) =>
            (rows as unknown as LeadSearchRow[]).map((r) => ({
              id: r.id,
              type: "lead" as const,
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
