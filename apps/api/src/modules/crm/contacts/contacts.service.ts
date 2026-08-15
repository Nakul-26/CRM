import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type { CreateContactInput, UpdateContactInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { accounts, contacts, users } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";

@Injectable()
export class ContactsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
  ) {}

  async list(organizationId: string, accountId?: string) {
    const conditions = [eq(contacts.organizationId, organizationId), isNull(contacts.deletedAt)];
    if (accountId) conditions.push(eq(contacts.accountId, accountId));
    return this.db.select().from(contacts).where(and(...conditions));
  }

  async findById(organizationId: string, contactId: string) {
    const [contact] = await this.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId), isNull(contacts.deletedAt)))
      .limit(1);
    if (!contact) throw new NotFoundException(`Contact ${contactId} not found`);
    return contact;
  }

  async create(organizationId: string, actorId: string, input: CreateContactInput) {
    if (input.accountId) {
      await this.requireAccountInOrganization(organizationId, input.accountId);
    }
    if (input.ownerId) {
      await this.requireUserInOrganization(organizationId, input.ownerId);
    }

    const [contact] = await this.db
      .insert(contacts)
      .values({ organizationId, ...input, createdBy: actorId, updatedBy: actorId })
      .returning();

    this.events.publish({
      eventType: "contact.created",
      organizationId,
      actorId,
      payload: { contactId: contact.id, accountId: contact.accountId, fullName: `${contact.firstName} ${contact.lastName}` },
    });
    return contact;
  }

  async update(organizationId: string, actorId: string, contactId: string, input: UpdateContactInput) {
    const existing = await this.findById(organizationId, contactId);
    if (input.accountId) {
      await this.requireAccountInOrganization(organizationId, input.accountId);
    }
    if (input.ownerId) {
      await this.requireUserInOrganization(organizationId, input.ownerId);
    }

    const [contact] = await this.db
      .update(contacts)
      .set({ ...input, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId)))
      .returning();

    this.events.publish({
      eventType: "contact.updated",
      organizationId,
      actorId,
      payload: { contactId, accountId: input.accountId ?? existing.accountId, changes: input },
    });
    return contact;
  }

  async delete(organizationId: string, actorId: string, contactId: string) {
    const existing = await this.findById(organizationId, contactId);

    await this.db
      .update(contacts)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId)));

    this.events.publish({
      eventType: "contact.deleted",
      organizationId,
      actorId,
      payload: { contactId, accountId: existing.accountId },
    });
  }

  private async requireAccountInOrganization(organizationId: string, accountId: string) {
    const [account] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.organizationId, organizationId), eq(accounts.id, accountId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!account) throw new NotFoundException(`Account ${accountId} not found`);
  }

  private async requireUserInOrganization(organizationId: string, userId: string) {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.id, userId)))
      .limit(1);
    if (!user) throw new NotFoundException(`User ${userId} not found`);
  }
}
