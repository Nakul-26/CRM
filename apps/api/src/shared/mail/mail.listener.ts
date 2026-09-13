import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OnEvent } from "@nestjs/event-emitter";
import type { ApiEnv } from "@sales-platform/config";
import type { DomainEvent, TicketCommentSource } from "@sales-platform/contracts";
import { RabbitMQDomainEventConsumer } from "../events/rabbitmq-domain-event-consumer";
import { MailerService } from "./mailer.service";

const QUEUE_NAME = "mail.consumer";
const ROUTING_KEYS = ["quote.sent", "ticket.created", "ticket.comment_added", "subscription.renewal_reminder_sent"];

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
  replyTo?: string | null;
}

interface TicketCommentAddedPayload {
  ticketId: string;
  body: string;
  isPublic: boolean;
  contactEmail?: string | null;
  contactName?: string | null;
  replyTo?: string | null;
  source?: TicketCommentSource;
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
 *
 * Under EVENT_BUS_TRANSPORT=rabbitmq (Phase 22, see
 * docs/decisions/0022-rabbitmq-general-adoption-phase22-scope.md), each
 * @OnEvent handler below defers entirely to its own durable queue consumer
 * (bound to only these 4 event types on the same `domain.events` exchange
 * AuditListener already republishes every event onto) instead of sending
 * immediately in-process. This listener never publishes anything itself —
 * doing so would double-deliver, since AuditListener's existing blanket
 * republish is already the sole publish point for the whole system.
 */
@Injectable()
export class MailListener implements OnModuleInit {
  private readonly logger = new Logger(MailListener.name);

  constructor(
    private readonly mailer: MailerService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get("EVENT_BUS_TRANSPORT", { infer: true }) === "rabbitmq") {
      const consumer = new RabbitMQDomainEventConsumer(this.config, QUEUE_NAME);
      await consumer.startConsuming(ROUTING_KEYS, (event) => this.handleEvent(event));
    }
  }

  private isRabbitMode(): boolean {
    return this.config.get("EVENT_BUS_TRANSPORT", { infer: true }) === "rabbitmq";
  }

  private async handleEvent(event: DomainEvent): Promise<void> {
    switch (event.eventType) {
      case "quote.sent":
        return this.handleQuoteSent(event as DomainEvent<"quote.sent", QuoteSentPayload>);
      case "ticket.created":
        return this.handleTicketCreated(event as DomainEvent<"ticket.created", TicketCreatedPayload>);
      case "ticket.comment_added":
        return this.handleTicketCommentAdded(event as DomainEvent<"ticket.comment_added", TicketCommentAddedPayload>);
      case "subscription.renewal_reminder_sent":
        return this.handleSubscriptionRenewalReminderSent(
          event as DomainEvent<"subscription.renewal_reminder_sent", SubscriptionRenewalReminderSentPayload>,
        );
      default:
        this.logger.warn(`Received unexpected event type "${event.eventType}" — ignoring`);
    }
  }

  @OnEvent("quote.sent")
  async onQuoteSent(event: DomainEvent<"quote.sent", QuoteSentPayload>): Promise<void> {
    if (this.isRabbitMode()) return;
    await this.handleQuoteSent(event);
  }

  private async handleQuoteSent(event: DomainEvent<"quote.sent", QuoteSentPayload>): Promise<void> {
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
    if (this.isRabbitMode()) return;
    await this.handleTicketCreated(event);
  }

  private async handleTicketCreated(event: DomainEvent<"ticket.created", TicketCreatedPayload>): Promise<void> {
    await this.dispatch(event.eventType, async () => {
      const { subject, contactEmail, contactName, replyTo } = event.payload;
      const greeting = contactName ? `Hi ${contactName},` : "Hi,";
      await this.mailer.send({
        to: contactEmail,
        subject: `We've received your request: ${subject}`,
        html: `<p>${greeting}</p><p>We've opened a support ticket for "${subject}" and will follow up soon.</p>`,
        text: `${greeting}\n\nWe've opened a support ticket for "${subject}" and will follow up soon.`,
        replyTo,
      });
    });
  }

  @OnEvent("ticket.comment_added")
  async onTicketCommentAdded(event: DomainEvent<"ticket.comment_added", TicketCommentAddedPayload>): Promise<void> {
    if (this.isRabbitMode()) return;
    await this.handleTicketCommentAdded(event);
  }

  private async handleTicketCommentAdded(event: DomainEvent<"ticket.comment_added", TicketCommentAddedPayload>): Promise<void> {
    if (!event.payload.isPublic) return;
    // Never echo a customer's own reply back to them.
    if (event.payload.source === "inbound_email") return;

    await this.dispatch(event.eventType, async () => {
      const { body, contactEmail, contactName, replyTo } = event.payload;
      const greeting = contactName ? `Hi ${contactName},` : "Hi,";
      await this.mailer.send({
        to: contactEmail,
        subject: "Update on your support ticket",
        html: `<p>${greeting}</p><p>${body}</p>`,
        text: `${greeting}\n\n${body}`,
        replyTo,
      });
    });
  }

  @OnEvent("subscription.renewal_reminder_sent")
  async onSubscriptionRenewalReminderSent(
    event: DomainEvent<"subscription.renewal_reminder_sent", SubscriptionRenewalReminderSentPayload>,
  ): Promise<void> {
    if (this.isRabbitMode()) return;
    await this.handleSubscriptionRenewalReminderSent(event);
  }

  private async handleSubscriptionRenewalReminderSent(
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
