import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "@sales-platform/contracts";
import { DomainEventsConsumer } from "../rabbitmq/domain-events-consumer";
import { NotificationsService } from "./notifications.service";

interface TicketAssignedPayload {
  ticketId: string;
  assigneeId: string | null;
}

interface OpportunityOutcomePayload {
  opportunityId: string;
  value: string | number | null;
  currency?: string;
  ownerId: string | null;
}

interface QuoteOutcomePayload {
  quoteId: string;
  ownerId: string | null;
}

interface PaymentOutcomePayload {
  paymentId: string;
  subscriptionId: string;
  recipientId: string | null;
}

const ROUTING_KEYS = ["ticket.assigned", "opportunity.won", "opportunity.lost", "quote.accepted", "quote.rejected", "payment.succeeded", "payment.failed"];

/**
 * Ported from apps/api/src/modules/notifications/notifications.listener.ts
 * (Phase 18) — same bounded set of events, same recipient-resolution and
 * title/link copy, same "skip if recipient is null or is the actor" rule,
 * same best-effort caught-and-logged posture. The only thing that changed
 * is the trigger: a RabbitMQ message instead of an in-process `@OnEvent`,
 * since this service runs in its own process and can no longer see
 * apps/api's local EventEmitter2. See
 * docs/decisions/0018-microservices-split-phase18-scope.md.
 */
@Injectable()
export class NotificationsConsumerService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsConsumerService.name);

  constructor(
    private readonly consumer: DomainEventsConsumer,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.consumer.startConsuming(ROUTING_KEYS, (event) => this.handleEvent(event));
  }

  private async handleEvent(event: DomainEvent): Promise<void> {
    switch (event.eventType) {
      case "ticket.assigned": {
        const { ticketId, assigneeId } = event.payload as TicketAssignedPayload;
        return this.notify(event, assigneeId, { type: event.eventType, title: "A ticket was assigned to you", link: `/support/tickets/${ticketId}` });
      }
      case "opportunity.won": {
        const { opportunityId, ownerId } = event.payload as OpportunityOutcomePayload;
        return this.notify(event, ownerId, { type: event.eventType, title: "Your opportunity was won", link: `/sales/opportunities/${opportunityId}` });
      }
      case "opportunity.lost": {
        const { opportunityId, ownerId } = event.payload as OpportunityOutcomePayload;
        return this.notify(event, ownerId, { type: event.eventType, title: "Your opportunity was lost", link: `/sales/opportunities/${opportunityId}` });
      }
      case "quote.accepted": {
        const { quoteId, ownerId } = event.payload as QuoteOutcomePayload;
        return this.notify(event, ownerId, { type: event.eventType, title: "Your quote was accepted", link: `/quotes/${quoteId}` });
      }
      case "quote.rejected": {
        const { quoteId, ownerId } = event.payload as QuoteOutcomePayload;
        return this.notify(event, ownerId, { type: event.eventType, title: "Your quote was rejected", link: `/quotes/${quoteId}` });
      }
      case "payment.succeeded": {
        const { recipientId } = event.payload as PaymentOutcomePayload;
        return this.notify(event, recipientId, { type: event.eventType, title: "A subscription renewal payment succeeded", link: "/subscriptions" });
      }
      case "payment.failed": {
        const { recipientId } = event.payload as PaymentOutcomePayload;
        return this.notify(event, recipientId, { type: event.eventType, title: "A subscription renewal payment failed", link: "/subscriptions" });
      }
      default:
        // The queue is bound only to the 7 routing keys above, so this
        // shouldn't happen — but a stray/legacy message must not crash the
        // consumer or get endlessly redelivered, so treat it as handled.
        this.logger.warn(`Received unexpected event type "${event.eventType}" — ignoring`);
    }
  }

  private async notify(event: DomainEvent, recipientId: string | null | undefined, input: { type: string; title: string; link: string }): Promise<void> {
    if (!recipientId || recipientId === event.actorId) return;

    try {
      await this.notifications.create(event.organizationId, recipientId, input);
    } catch (error) {
      this.logger.error(`Failed to create notification for event "${event.eventType}"`, error as Error);
    }
  }
}
