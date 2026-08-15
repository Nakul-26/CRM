import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { TIMELINE_EVENT_TYPES, type TimelineEntryDto } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { accounts, activities, auditLog, contacts } from "../../../database/schema";

export interface TimelineFilters {
  type?: string;
  from?: string;
  to?: string;
  before?: string;
  limit?: number;
}

function summarizeEvent(eventType: string, payload: Record<string, unknown> | null): string {
  switch (eventType) {
    case "account.created":
      return `Account "${payload?.name ?? ""}" was created`;
    case "account.updated":
      return "Account details were updated";
    case "account.deleted":
      return "Account was deleted";
    case "contact.created":
      return `Contact "${payload?.fullName ?? ""}" was created`;
    case "contact.updated":
      return "Contact details were updated";
    case "contact.deleted":
      return "Contact was deleted";
    default:
      return eventType;
  }
}

@Injectable()
export class TimelineService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  /**
   * Read-time merge of two independent sources — crm.activities and
   * identity.audit_log (filtered to TIMELINE_EVENT_TYPES) — rather than a
   * dedicated timeline table. Later phases (opportunities/quotes/
   * subscriptions/tickets) only need to publish events with `accountId` in
   * their payload and get added to TIMELINE_EVENT_TYPES to appear here; no
   * change to this query is required.
   */
  async forAccount(organizationId: string, accountId: string, filters: TimelineFilters): Promise<TimelineEntryDto[]> {
    await this.requireAccountInOrganization(organizationId, accountId);

    const contactRows = await this.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.accountId, accountId));
    const contactIds = contactRows.map((c) => c.id);

    const activityCondition =
      contactIds.length > 0 ? or(eq(activities.accountId, accountId), inArray(activities.contactId, contactIds)) : eq(activities.accountId, accountId);

    const [activityRows, auditRows] = await Promise.all([
      this.db
        .select()
        .from(activities)
        .where(and(eq(activities.organizationId, organizationId), activityCondition)),
      this.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.organizationId, organizationId),
            inArray(auditLog.eventType, [...TIMELINE_EVENT_TYPES]),
            sql`${auditLog.payload}->>'accountId' = ${accountId}`,
          ),
        ),
    ]);

    const entries: TimelineEntryDto[] = [
      ...activityRows.map((a) => ({
        id: a.id,
        source: "activity" as const,
        type: a.type,
        occurredAt: a.createdAt.toISOString(),
        actorId: a.ownerId ?? undefined,
        accountId: a.accountId ?? accountId,
        contactId: a.contactId ?? undefined,
        summary: a.subject,
        payload: { body: a.body, dueAt: a.dueAt, completedAt: a.completedAt },
      })),
      ...auditRows.map((e) => ({
        id: e.id,
        source: "event" as const,
        type: e.eventType,
        occurredAt: e.createdAt.toISOString(),
        actorId: e.actorId ?? undefined,
        accountId,
        contactId: (e.payload as Record<string, unknown> | null)?.contactId as string | undefined,
        summary: summarizeEvent(e.eventType, e.payload),
        payload: e.payload ?? {},
      })),
    ];

    let filtered = entries;
    if (filters.type) filtered = filtered.filter((e) => e.type === filters.type);
    if (filters.from) filtered = filtered.filter((e) => e.occurredAt >= filters.from!);
    if (filters.to) filtered = filtered.filter((e) => e.occurredAt <= filters.to!);
    if (filters.before) filtered = filtered.filter((e) => e.occurredAt < filters.before!);

    filtered.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return filtered.slice(0, filters.limit ?? 50);
  }

  private async requireAccountInOrganization(organizationId: string, accountId: string) {
    const [account] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.organizationId, organizationId), eq(accounts.id, accountId)))
      .limit(1);
    if (!account) throw new NotFoundException(`Account ${accountId} not found`);
  }
}
