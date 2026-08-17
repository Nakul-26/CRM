import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { DomainEvent } from "@sales-platform/contracts";
import { MailerService } from "./mailer.service";

interface QuoteSentPayload {
  quoteId: string;
  contactEmail?: string | null;
  contactName?: string | null;
  publicUrl?: string;
}

interface TicketCreatedPayload {
  ticketId: string;
  subject: string;
  contactEmail?: string | null;
  contactName?: string | null;
}

interface TicketCommentAddedPayload {
  ticketId: string;
  body: string;
  isPublic: boolean;
  contactEmail?: string | null;
  contactName?: string | null;
}

interface SubscriptionRenewalReminderSentPayload {
  subscriptionId: string;
  planName: string;
  currentPeriodEnd: string;
  contactEmail?: string | null;
  contactName?: string | null;
}

/**
 * Cross-cutting, event-driven email dispatch — same shape as AuditListener
 * (@OnEvent-driven, registered in SharedModule). Publishing services enrich
 * their own event payloads with everything an email needs (recipient
 * address/name, ready-built links); this listener has no DB/service
 * dependencies beyond MailerService — see docs/decisions/0006-support-phase6-scope.md.
 * The subscription-renewal-reminder handler below is published by
 * RenewalsService, a scheduled job with no request context, rather than a
 * user action — see docs/decisions/0007-subscriptions-phase7-scope.md.
 */
@Injectable()
export class MailListener {
  private readonly logger = new Logger(MailListener.name);

  constructor(private readonly mailer: MailerService) {}

  @OnEvent("quote.sent")
  async onQuoteSent(event: DomainEvent<"quote.sent", QuoteSentPayload>): Promise<void> {
    await this.dispatch(event.eventType, async () => {
      const { contactEmail, contactName, publicUrl } = event.payload;
      const greeting = contactName ? `Hi ${contactName},` : "Hi,";
      const link = publicUrl ?? "";
      await this.mailer.send({
        to: contactEmail,
        subject: "A quote has been sent to you",
        html: `<p>${greeting}</p><p>A new quote is ready for your review.</p><p><a href="${link}">View and respond to your quote</a></p>`,
        text: `${greeting}\n\nA new quote is ready for your review: ${link}`,
      });
    });
  }

  @OnEvent("ticket.created")
  async onTicketCreated(event: DomainEvent<"ticket.created", TicketCreatedPayload>): Promise<void> {
    await this.dispatch(event.eventType, async () => {
      const { subject, contactEmail, contactName } = event.payload;
      const greeting = contactName ? `Hi ${contactName},` : "Hi,";
      await this.mailer.send({
        to: contactEmail,
        subject: `We've received your request: ${subject}`,
        html: `<p>${greeting}</p><p>We've opened a support ticket for "${subject}" and will follow up soon.</p>`,
        text: `${greeting}\n\nWe've opened a support ticket for "${subject}" and will follow up soon.`,
      });
    });
  }

  @OnEvent("ticket.comment_added")
  async onTicketCommentAdded(event: DomainEvent<"ticket.comment_added", TicketCommentAddedPayload>): Promise<void> {
    if (!event.payload.isPublic) return;

    await this.dispatch(event.eventType, async () => {
      const { body, contactEmail, contactName } = event.payload;
      const greeting = contactName ? `Hi ${contactName},` : "Hi,";
      await this.mailer.send({
        to: contactEmail,
        subject: "Update on your support ticket",
        html: `<p>${greeting}</p><p>${body}</p>`,
        text: `${greeting}\n\n${body}`,
      });
    });
  }

  @OnEvent("subscription.renewal_reminder_sent")
  async onSubscriptionRenewalReminderSent(
    event: DomainEvent<"subscription.renewal_reminder_sent", SubscriptionRenewalReminderSentPayload>,
  ): Promise<void> {
    await this.dispatch(event.eventType, async () => {
      const { planName, currentPeriodEnd, contactEmail, contactName } = event.payload;
      const greeting = contactName ? `Hi ${contactName},` : "Hi,";
      const renewalDate = new Date(currentPeriodEnd).toLocaleDateString();
      await this.mailer.send({
        to: contactEmail,
        subject: `Your ${planName} subscription renews soon`,
        html: `<p>${greeting}</p><p>Your ${planName} subscription renews on ${renewalDate}. No action is needed if you'd like it to continue.</p>`,
        text: `${greeting}\n\nYour ${planName} subscription renews on ${renewalDate}. No action is needed if you'd like it to continue.`,
      });
    });
  }

  private async dispatch(eventType: string, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      // Email dispatch must never break the business operation that
      // triggered it — log and move on rather than throwing.
      this.logger.error(`Failed to send email for event "${eventType}"`, error as Error);
    }
  }
}
