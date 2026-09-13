import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OnEvent } from "@nestjs/event-emitter";
import type { ApiEnv } from "@sales-platform/config";
import type { DomainEvent } from "@sales-platform/contracts";
import { RabbitMQDomainEventConsumer } from "../../shared/events/rabbitmq-domain-event-consumer";
import { NotificationsService } from "./notifications.service";

const QUEUE_NAME = "notifications.monolith.consumer";
const ROUTING_KEYS = ["ticket.assigned", "opportunity.won", "opportunity.lost", "quote.accepted", "quote.rejected", "payment.succeeded", "payment.failed"];

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

/**
 * A bounded, evidenced set of events — each has a single clear recipient
 * (`ownerId`/`assigneeId`) already carried in its payload. See
 * docs/decisions/0009-notifications-phase9-scope.md decision #2. Same
 * best-effort, caught-and-logged posture as MailListener/AuditListener:
 * never break the operation that published the event.
 *
 * Only ever registered when NOTIFICATIONS_SERVICE_ENABLED=false — the whole
 * NotificationsModule is excluded from the monolith otherwise (see
 * app.module.ts), since apps/notifications-service's own
 * NotificationsConsumerService (ported from this exact class in Phase 18)
 * takes over. Under EVENT_BUS_TRANSPORT=rabbitmq (Phase 22, see
 * docs/decisions/0022-rabbitmq-general-adoption-phase22-scope.md), each
 * @OnEvent handler below defers to its own durable queue consumer instead
 * of notifying immediately in-process — this listener never publishes
 * anything itself, only consumes, to avoid double-delivering via
 * AuditListener's existing blanket republish.
 */
@Injectable()
export class NotificationsListener implements OnModuleInit {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
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
      case "ticket.assigned":
        return this.handleTicketAssigned(event as DomainEvent<"ticket.assigned", TicketAssignedPayload>);
      case "opportunity.won":
        return this.handleOpportunityWon(event as DomainEvent<"opportunity.won", OpportunityOutcomePayload>);
      case "opportunity.lost":
        return this.handleOpportunityLost(event as DomainEvent<"opportunity.lost", OpportunityOutcomePayload>);
      case "quote.accepted":
        return this.handleQuoteAccepted(event as DomainEvent<"quote.accepted", QuoteOutcomePayload>);
      case "quote.rejected":
        return this.handleQuoteRejected(event as DomainEvent<"quote.rejected", QuoteOutcomePayload>);
      case "payment.succeeded":
        return this.handlePaymentSucceeded(event as DomainEvent<"payment.succeeded", PaymentOutcomePayload>);
      case "payment.failed":
        return this.handlePaymentFailed(event as DomainEvent<"payment.failed", PaymentOutcomePayload>);
      default:
        this.logger.warn(`Received unexpected event type "${event.eventType}" — ignoring`);
    }
  }

  @OnEvent("ticket.assigned")
  async onTicketAssigned(event: DomainEvent<"ticket.assigned", TicketAssignedPayload>): Promise<void> {
    if (this.isRabbitMode()) return;
    await this.handleTicketAssigned(event);
  }

  private async handleTicketAssigned(event: DomainEvent<"ticket.assigned", TicketAssignedPayload>): Promise<void> {
    const { ticketId, assigneeId } = event.payload;
    await this.notify(event, assigneeId, {
      type: event.eventType,
      title: "A ticket was assigned to you",
      link: `/support/tickets/${ticketId}`,
    });
  }

  @OnEvent("opportunity.won")
  async onOpportunityWon(event: DomainEvent<"opportunity.won", OpportunityOutcomePayload>): Promise<void> {
    if (this.isRabbitMode()) return;
    await this.handleOpportunityWon(event);
  }

  private async handleOpportunityWon(event: DomainEvent<"opportunity.won", OpportunityOutcomePayload>): Promise<void> {
    const { opportunityId, ownerId } = event.payload;
    await this.notify(event, ownerId, {
      type: event.eventType,
      title: "Your opportunity was won",
      link: `/sales/opportunities/${opportunityId}`,
    });
  }

  @OnEvent("opportunity.lost")
  async onOpportunityLost(event: DomainEvent<"opportunity.lost", OpportunityOutcomePayload>): Promise<void> {
    if (this.isRabbitMode()) return;
    await this.handleOpportunityLost(event);
  }

  private async handleOpportunityLost(event: DomainEvent<"opportunity.lost", OpportunityOutcomePayload>): Promise<void> {
    const { opportunityId, ownerId } = event.payload;
    await this.notify(event, ownerId, {
      type: event.eventType,
      title: "Your opportunity was lost",
      link: `/sales/opportunities/${opportunityId}`,
    });
  }

  @OnEvent("quote.accepted")
  async onQuoteAccepted(event: DomainEvent<"quote.accepted", QuoteOutcomePayload>): Promise<void> {
    if (this.isRabbitMode()) return;
    await this.handleQuoteAccepted(event);
  }

  private async handleQuoteAccepted(event: DomainEvent<"quote.accepted", QuoteOutcomePayload>): Promise<void> {
    const { quoteId, ownerId } = event.payload;
    await this.notify(event, ownerId, {
      type: event.eventType,
      title: "Your quote was accepted",
      link: `/quotes/${quoteId}`,
    });
  }

  @OnEvent("quote.rejected")
  async onQuoteRejected(event: DomainEvent<"quote.rejected", QuoteOutcomePayload>): Promise<void> {
    if (this.isRabbitMode()) return;
    await this.handleQuoteRejected(event);
  }

  private async handleQuoteRejected(event: DomainEvent<"quote.rejected", QuoteOutcomePayload>): Promise<void> {
    const { quoteId, ownerId } = event.payload;
    await this.notify(event, ownerId, {
      type: event.eventType,
      title: "Your quote was rejected",
      link: `/quotes/${quoteId}`,
    });
  }

  @OnEvent("payment.succeeded")
  async onPaymentSucceeded(event: DomainEvent<"payment.succeeded", PaymentOutcomePayload>): Promise<void> {
    if (this.isRabbitMode()) return;
    await this.handlePaymentSucceeded(event);
  }

  private async handlePaymentSucceeded(event: DomainEvent<"payment.succeeded", PaymentOutcomePayload>): Promise<void> {
    await this.notify(event, event.payload.recipientId, {
      type: event.eventType,
      title: "A subscription renewal payment succeeded",
      link: "/subscriptions",
    });
  }

  @OnEvent("payment.failed")
  async onPaymentFailed(event: DomainEvent<"payment.failed", PaymentOutcomePayload>): Promise<void> {
    if (this.isRabbitMode()) return;
    await this.handlePaymentFailed(event);
  }

  private async handlePaymentFailed(event: DomainEvent<"payment.failed", PaymentOutcomePayload>): Promise<void> {
    await this.notify(event, event.payload.recipientId, {
      type: event.eventType,
      title: "A subscription renewal payment failed",
      link: "/subscriptions",
    });
  }

  private async notify(
    event: DomainEvent,
    recipientId: string | null | undefined,
    input: { type: string; title: string; link: string },
  ): Promise<void> {
    if (!recipientId || recipientId === event.actorId) return;

    try {
      await this.notifications.create(event.organizationId, recipientId, input);
    } catch (error) {
      this.logger.error(`Failed to create notification for event "${event.eventType}"`, error as Error);
    }
  }
}
