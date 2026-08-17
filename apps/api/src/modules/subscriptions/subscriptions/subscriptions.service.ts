import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ERROR_CODES, type BillingInterval, type CreateSubscriptionInput, type SubscriptionStatus, type UpdateSubscriptionInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { accounts, contacts, renewalReminders, subscriptions } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";
import { PlansService } from "../plans/plans.service";
import { isLapseDue } from "./subscription-lapse";

type SubscriptionRow = typeof subscriptions.$inferSelect;

const RENEWAL_REMINDER_LEAD_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addBillingInterval(from: Date, interval: BillingInterval): Date {
  const next = new Date(from);
  if (interval === "yearly") next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
    private readonly plans: PlansService,
  ) {}

  async list(organizationId: string, filters?: { status?: SubscriptionStatus; accountId?: string }) {
    const conditions = [eq(subscriptions.organizationId, organizationId), isNull(subscriptions.deletedAt)];
    if (filters?.status) conditions.push(eq(subscriptions.status, filters.status));
    if (filters?.accountId) conditions.push(eq(subscriptions.accountId, filters.accountId));

    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(and(...conditions))
      .orderBy(asc(subscriptions.currentPeriodEnd));

    const lapsed = await Promise.all(rows.map((row) => this.lapseIfDue(row)));
    return Promise.all(lapsed.map((row) => this.serialize(row)));
  }

  async findById(organizationId: string, subscriptionId: string) {
    let subscription = await this.getRawSubscription(organizationId, subscriptionId);
    subscription = await this.lapseIfDue(subscription);
    return this.serialize(subscription);
  }

  async create(organizationId: string, actorId: string, input: CreateSubscriptionInput) {
    await this.requireAccountInOrganization(organizationId, input.accountId);
    if (input.contactId) await this.requireContactInOrganization(organizationId, input.contactId);

    const plan = await this.plans.getRawByIdOrThrow(organizationId, input.planId);
    const currentPeriodStart = input.currentPeriodStart ? new Date(input.currentPeriodStart) : new Date();
    const currentPeriodEnd = addBillingInterval(currentPeriodStart, plan.billingInterval as BillingInterval);

    const [subscription] = await this.db
      .insert(subscriptions)
      .values({
        organizationId,
        accountId: input.accountId,
        contactId: input.contactId,
        planId: plan.id,
        planName: plan.name,
        price: plan.price,
        billingInterval: plan.billingInterval,
        currentPeriodStart,
        currentPeriodEnd,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    await this.scheduleReminder(organizationId, subscription.id, currentPeriodEnd);

    this.events.publish({
      eventType: "subscription.created",
      organizationId,
      actorId,
      payload: { subscriptionId: subscription.id, accountId: subscription.accountId, planId: plan.id, planName: plan.name },
    });
    return this.serialize(subscription);
  }

  async update(organizationId: string, actorId: string, subscriptionId: string, input: UpdateSubscriptionInput) {
    const existing = await this.getRawSubscription(organizationId, subscriptionId);
    if (input.contactId) await this.requireContactInOrganization(organizationId, input.contactId);

    const [subscription] = await this.db
      .update(subscriptions)
      .set({ contactId: input.contactId, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.id, subscriptionId)))
      .returning();

    this.events.publish({
      eventType: "subscription.updated",
      organizationId,
      actorId,
      payload: { subscriptionId, accountId: existing.accountId, changes: input },
    });
    return this.serialize(subscription);
  }

  async cancel(organizationId: string, actorId: string, subscriptionId: string) {
    const existing = await this.getRawSubscription(organizationId, subscriptionId);
    if (existing.status === "cancelled") {
      throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: "Subscription is already cancelled" });
    }

    const [subscription] = await this.db
      .update(subscriptions)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.id, subscriptionId)))
      .returning();

    // No reminder should fire for a cancelled subscription.
    await this.db
      .delete(renewalReminders)
      .where(and(eq(renewalReminders.subscriptionId, subscriptionId), isNull(renewalReminders.sentAt)));

    this.events.publish({
      eventType: "subscription.cancelled",
      organizationId,
      actorId,
      payload: { subscriptionId, accountId: subscription.accountId },
    });
    return this.serialize(subscription);
  }

  async renew(organizationId: string, actorId: string, subscriptionId: string) {
    const existing = await this.getRawSubscription(organizationId, subscriptionId);
    if (existing.status === "cancelled") {
      throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: "Cannot renew a cancelled subscription" });
    }

    // Always chains from the previous period end, even if renewed late, so
    // periods never overlap or leave an unaccounted gap.
    const currentPeriodStart = existing.currentPeriodEnd;
    const currentPeriodEnd = addBillingInterval(currentPeriodStart, existing.billingInterval as BillingInterval);

    const [subscription] = await this.db
      .update(subscriptions)
      .set({ status: "active", currentPeriodStart, currentPeriodEnd, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.id, subscriptionId)))
      .returning();

    await this.scheduleReminder(organizationId, subscriptionId, currentPeriodEnd);

    this.events.publish({
      eventType: "subscription.renewed",
      organizationId,
      actorId,
      payload: { subscriptionId, accountId: subscription.accountId, currentPeriodEnd: currentPeriodEnd.toISOString() },
    });
    return this.serialize(subscription);
  }

  async delete(organizationId: string, actorId: string, subscriptionId: string) {
    await this.getRawSubscription(organizationId, subscriptionId);

    await this.db
      .update(subscriptions)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.id, subscriptionId)));

    this.events.publish({
      eventType: "subscription.deleted",
      organizationId,
      actorId,
      payload: { subscriptionId },
    });
  }

  /** Checked/persisted on access ("touch-on-access"), same lazy pattern as QuotesService.expireIfDue. */
  private async lapseIfDue(subscription: SubscriptionRow): Promise<SubscriptionRow> {
    if (!isLapseDue({ status: subscription.status as SubscriptionStatus, currentPeriodEnd: subscription.currentPeriodEnd }, new Date())) {
      return subscription;
    }

    await this.db.update(subscriptions).set({ status: "lapsed", updatedAt: new Date() }).where(eq(subscriptions.id, subscription.id));
    this.events.publish({
      eventType: "subscription.lapsed",
      organizationId: subscription.organizationId,
      payload: { subscriptionId: subscription.id, accountId: subscription.accountId },
    });
    return { ...subscription, status: "lapsed" };
  }

  private async scheduleReminder(organizationId: string, subscriptionId: string, currentPeriodEnd: Date) {
    const remindAt = new Date(currentPeriodEnd.getTime() - RENEWAL_REMINDER_LEAD_DAYS * MS_PER_DAY);
    await this.db.insert(renewalReminders).values({ organizationId, subscriptionId, remindAt });
  }

  private async serialize(row: SubscriptionRow) {
    const currentPeriodReminderSent = await this.hasCurrentPeriodReminderSent(row.id);
    return {
      ...row,
      status: row.status as SubscriptionStatus,
      billingInterval: row.billingInterval as BillingInterval,
      price: Number(row.price),
      currentPeriodStart: row.currentPeriodStart.toISOString(),
      currentPeriodEnd: row.currentPeriodEnd.toISOString(),
      cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      currentPeriodReminderSent,
    };
  }

  private async hasCurrentPeriodReminderSent(subscriptionId: string): Promise<boolean> {
    const [latest] = await this.db
      .select({ sentAt: renewalReminders.sentAt })
      .from(renewalReminders)
      .where(eq(renewalReminders.subscriptionId, subscriptionId))
      .orderBy(desc(renewalReminders.createdAt))
      .limit(1);
    return Boolean(latest?.sentAt);
  }

  private async getRawSubscription(organizationId: string, subscriptionId: string): Promise<SubscriptionRow> {
    const [subscription] = await this.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.id, subscriptionId), isNull(subscriptions.deletedAt)))
      .limit(1);
    if (!subscription) throw new NotFoundException(`Subscription ${subscriptionId} not found`);
    return subscription;
  }

  private async requireAccountInOrganization(organizationId: string, accountId: string) {
    const [account] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.organizationId, organizationId), eq(accounts.id, accountId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!account) throw new NotFoundException(`Account ${accountId} not found`);
  }

  private async requireContactInOrganization(organizationId: string, contactId: string) {
    const [contact] = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId), isNull(contacts.deletedAt)))
      .limit(1);
    if (!contact) throw new NotFoundException(`Contact ${contactId} not found`);
  }
}
