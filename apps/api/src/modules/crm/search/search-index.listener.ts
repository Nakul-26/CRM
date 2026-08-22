import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OnEvent } from "@nestjs/event-emitter";
import { and, eq, isNull } from "drizzle-orm";
import type { ApiEnv } from "@sales-platform/config";
import type { DomainEvent } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { accounts, contacts, leads } from "../../../database/schema";
import { OpenSearchSearchProvider } from "./providers/opensearch-search.provider";

/**
 * Keeps the OpenSearch index in sync with account/contact/lead writes — a
 * wildcard subscriber sibling to AuditListener, active only when
 * SEARCH_PROVIDER=opensearch. Re-reads the current row on create/update
 * rather than trusting the event payload (an ".updated" payload only ever
 * carries the changed fields, not the full row — see
 * docs/decisions/0015-opensearch-phase15-scope.md), so the index always
 * reflects live truth regardless of what a given event happens to include.
 * Never throws — a missed index update must never break the write that
 * triggered it.
 */
@Injectable()
export class SearchIndexListener {
  private readonly logger = new Logger(SearchIndexListener.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly config: ConfigService<ApiEnv, true>,
    private readonly opensearch: OpenSearchSearchProvider,
  ) {}

  @OnEvent("domain.event")
  async handle(event: DomainEvent): Promise<void> {
    if (this.config.get("SEARCH_PROVIDER", { infer: true }) !== "opensearch") return;

    try {
      switch (event.eventType) {
        case "account.created":
        case "account.updated":
          await this.indexAccount(event);
          return;
        case "account.deleted":
          await this.opensearch.deleteDocument("account", (event.payload as { accountId: string }).accountId);
          return;
        case "contact.created":
        case "contact.updated":
          await this.indexContact(event);
          return;
        case "contact.deleted":
          await this.opensearch.deleteDocument("contact", (event.payload as { contactId: string }).contactId);
          return;
        case "lead.created":
        case "lead.updated":
          await this.indexLead(event);
          return;
        case "lead.deleted":
          await this.opensearch.deleteDocument("lead", (event.payload as { leadId: string }).leadId);
          return;
        default:
          return;
      }
    } catch (error) {
      this.logger.error(`Failed to sync search index for event "${event.eventType}"`, error as Error);
    }
  }

  private async indexAccount(event: DomainEvent): Promise<void> {
    const { accountId } = event.payload as { accountId: string };
    const [row] = await this.db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.organizationId, event.organizationId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!row) return;
    await this.opensearch.indexDocument({ type: "account", entityId: row.id, organizationId: event.organizationId, label: row.name });
  }

  private async indexContact(event: DomainEvent): Promise<void> {
    const { contactId } = event.payload as { contactId: string };
    const [row] = await this.db
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, event.organizationId), isNull(contacts.deletedAt)))
      .limit(1);
    if (!row) return;
    await this.opensearch.indexDocument({
      type: "contact",
      entityId: row.id,
      organizationId: event.organizationId,
      label: `${row.firstName} ${row.lastName}`,
      subLabel: row.email ?? undefined,
    });
  }

  private async indexLead(event: DomainEvent): Promise<void> {
    const { leadId } = event.payload as { leadId: string };
    const [row] = await this.db
      .select({ id: leads.id, name: leads.name, company: leads.company })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.organizationId, event.organizationId), isNull(leads.deletedAt)))
      .limit(1);
    if (!row) return;
    await this.opensearch.indexDocument({
      type: "lead",
      entityId: row.id,
      organizationId: event.organizationId,
      label: row.name,
      subLabel: row.company ?? undefined,
    });
  }
}
