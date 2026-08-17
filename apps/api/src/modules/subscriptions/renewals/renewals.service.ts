import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull, lte } from "drizzle-orm";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { contacts, renewalReminders, subscriptions } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";

/**
 * Polls the `renewal_reminders` job table — a Postgres-backed job table, not
 * Redis/BullMQ/Temporal, per docs/decisions/0001-modular-monolith.md and
 * docs/decisions/0007-subscriptions-phase7-scope.md. Called by
 * RenewalsScheduler on a timer, and directly in tests (no waiting on the
 * clock).
 */
@Injectable()
export class RenewalsService {
  private readonly logger = new Logger(RenewalsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
  ) {}

  async processDueReminders(now: Date = new Date()): Promise<number> {
    const due = await this.db
      .select({
        reminderId: renewalReminders.id,
        organizationId: renewalReminders.organizationId,
        subscriptionId: renewalReminders.subscriptionId,
      })
      .from(renewalReminders)
      .where(and(lte(renewalReminders.remindAt, now), isNull(renewalReminders.sentAt)));

    for (const reminder of due) {
      await this.dispatchReminder(reminder);
    }
    return due.length;
  }

  private async dispatchReminder(reminder: { reminderId: string; organizationId: string; subscriptionId: string }) {
    const [row] = await this.db
      .select({
        planName: subscriptions.planName,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        accountId: subscriptions.accountId,
        contactId: subscriptions.contactId,
      })
      .from(subscriptions)
      .where(eq(subscriptions.id, reminder.subscriptionId))
      .limit(1);
    if (!row) return;

    const contact = row.contactId ? await this.findContactForEmail(reminder.organizationId, row.contactId) : null;

    // Fire-and-forget, same best-effort posture AuditListener/MailListener
    // already use everywhere: mark dispatched immediately rather than
    // waiting to confirm delivery (see docs/decisions/0007-subscriptions-phase7-scope.md).
    this.events.publish({
      eventType: "subscription.renewal_reminder_sent",
      organizationId: reminder.organizationId,
      payload: {
        subscriptionId: reminder.subscriptionId,
        accountId: row.accountId,
        planName: row.planName,
        currentPeriodEnd: row.currentPeriodEnd.toISOString(),
        contactEmail: contact?.email ?? null,
        contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null,
      },
    });

    await this.db.update(renewalReminders).set({ sentAt: new Date() }).where(eq(renewalReminders.id, reminder.reminderId));
    this.logger.debug(`Dispatched renewal reminder ${reminder.reminderId} for subscription ${reminder.subscriptionId}`);
  }

  /** Snapshot lookup for email dispatch — the contact's address/name at the moment the reminder fired. */
  private async findContactForEmail(organizationId: string, contactId: string) {
    const [contact] = await this.db
      .select({ email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId), isNull(contacts.deletedAt)))
      .limit(1);
    return contact ?? null;
  }
}
