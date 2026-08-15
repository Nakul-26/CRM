import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type { CreateAccountInput, UpdateAccountInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { accounts, users } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
  ) {}

  async list(organizationId: string) {
    return this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.organizationId, organizationId), isNull(accounts.deletedAt)));
  }

  async findById(organizationId: string, accountId: string) {
    const [account] = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.organizationId, organizationId), eq(accounts.id, accountId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!account) throw new NotFoundException(`Account ${accountId} not found`);
    return account;
  }

  async create(organizationId: string, actorId: string, input: CreateAccountInput) {
    if (input.ownerId) {
      await this.requireUserInOrganization(organizationId, input.ownerId);
    }

    const [account] = await this.db
      .insert(accounts)
      .values({ organizationId, ...input, createdBy: actorId, updatedBy: actorId })
      .returning();

    this.events.publish({
      eventType: "account.created",
      organizationId,
      actorId,
      payload: { accountId: account.id, name: account.name },
    });
    return account;
  }

  async update(organizationId: string, actorId: string, accountId: string, input: UpdateAccountInput) {
    await this.findById(organizationId, accountId);
    if (input.ownerId) {
      await this.requireUserInOrganization(organizationId, input.ownerId);
    }

    const [account] = await this.db
      .update(accounts)
      .set({ ...input, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(accounts.organizationId, organizationId), eq(accounts.id, accountId)))
      .returning();

    this.events.publish({
      eventType: "account.updated",
      organizationId,
      actorId,
      payload: { accountId, changes: input },
    });
    return account;
  }

  async delete(organizationId: string, actorId: string, accountId: string) {
    // findById throws 404 first — without it, a cross-tenant delete would
    // silently affect zero rows and still report success + publish an
    // audit event claiming the deletion happened.
    await this.findById(organizationId, accountId);

    await this.db
      .update(accounts)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(accounts.organizationId, organizationId), eq(accounts.id, accountId)));

    this.events.publish({
      eventType: "account.deleted",
      organizationId,
      actorId,
      payload: { accountId },
    });
  }

  /** Tenant isolation guard: an owner assignment must resolve to a user in the same org. */
  private async requireUserInOrganization(organizationId: string, userId: string) {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.id, userId)))
      .limit(1);
    if (!user) throw new NotFoundException(`User ${userId} not found`);
  }
}
