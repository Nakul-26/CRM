import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { CreateActivityInput, UpdateActivityInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { accounts, activities, contacts } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";
import { OpportunitiesService } from "../../sales/opportunities/opportunities.service";

@Injectable()
export class ActivitiesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
    private readonly opportunities: OpportunitiesService,
  ) {}

  async list(organizationId: string, filters: { accountId?: string; contactId?: string; opportunityId?: string; type?: string }) {
    const conditions = [eq(activities.organizationId, organizationId)];
    if (filters.accountId) conditions.push(eq(activities.accountId, filters.accountId));
    if (filters.contactId) conditions.push(eq(activities.contactId, filters.contactId));
    if (filters.opportunityId) conditions.push(eq(activities.opportunityId, filters.opportunityId));
    if (filters.type) conditions.push(eq(activities.type, filters.type));
    return this.db.select().from(activities).where(and(...conditions));
  }

  async findById(organizationId: string, activityId: string) {
    const [activity] = await this.db
      .select()
      .from(activities)
      .where(and(eq(activities.organizationId, organizationId), eq(activities.id, activityId)))
      .limit(1);
    if (!activity) throw new NotFoundException(`Activity ${activityId} not found`);
    return activity;
  }

  async create(organizationId: string, actorId: string, input: CreateActivityInput) {
    if (!input.accountId && !input.contactId && !input.opportunityId) {
      throw new BadRequestException("One of accountId, contactId, or opportunityId is required");
    }
    if (input.accountId) {
      await this.requireAccountInOrganization(organizationId, input.accountId);
    }
    if (input.contactId) {
      await this.requireContactInOrganization(organizationId, input.contactId);
    }
    if (input.opportunityId) {
      // findById 404s if the opportunity doesn't belong to this org — same
      // existence check as accountId/contactId above, via the Sales
      // module's own service (opportunities.opportunityId has no DB-level
      // FK, see crm.schema.ts, so this is the only integrity check it gets).
      await this.opportunities.findById(organizationId, input.opportunityId);
    }

    const [activity] = await this.db
      .insert(activities)
      .values({
        organizationId,
        ownerId: actorId,
        ...input,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      })
      .returning();

    this.events.publish({
      eventType: "activity.logged",
      organizationId,
      actorId,
      payload: {
        activityId: activity.id,
        accountId: activity.accountId,
        contactId: activity.contactId,
        opportunityId: activity.opportunityId,
        type: activity.type,
      },
    });
    return activity;
  }

  async update(organizationId: string, actorId: string, activityId: string, input: UpdateActivityInput) {
    const existing = await this.findById(organizationId, activityId);

    const [activity] = await this.db
      .update(activities)
      .set({
        ...input,
        dueAt: input.dueAt !== undefined ? new Date(input.dueAt) : undefined,
        completedAt: input.completedAt !== undefined ? (input.completedAt ? new Date(input.completedAt) : null) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(activities.organizationId, organizationId), eq(activities.id, activityId)))
      .returning();

    this.events.publish({
      eventType: "activity.updated",
      organizationId,
      actorId,
      payload: { activityId, accountId: existing.accountId, contactId: existing.contactId, changes: input },
    });
    return activity;
  }

  async delete(organizationId: string, actorId: string, activityId: string) {
    const existing = await this.findById(organizationId, activityId);

    await this.db
      .delete(activities)
      .where(and(eq(activities.organizationId, organizationId), eq(activities.id, activityId)));

    this.events.publish({
      eventType: "activity.deleted",
      organizationId,
      actorId,
      payload: { activityId, accountId: existing.accountId, contactId: existing.contactId },
    });
  }

  private async requireAccountInOrganization(organizationId: string, accountId: string) {
    const [account] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.organizationId, organizationId), eq(accounts.id, accountId)))
      .limit(1);
    if (!account) throw new NotFoundException(`Account ${accountId} not found`);
  }

  private async requireContactInOrganization(organizationId: string, contactId: string) {
    const [contact] = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId)))
      .limit(1);
    if (!contact) throw new NotFoundException(`Contact ${contactId} not found`);
  }
}
