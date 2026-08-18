import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { DomainEvent } from "@sales-platform/contracts";
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

/**
 * A bounded, evidenced set of events — each has a single clear recipient
 * (`ownerId`/`assigneeId`) already carried in its payload. See
 * docs/decisions/0009-notifications-phase9-scope.md decision #2. Same
 * best-effort, caught-and-logged posture as MailListener/AuditListener:
 * never break the operation that published the event.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent("ticket.assigned")
  async onTicketAssigned(event: DomainEvent<"ticket.assigned", TicketAssignedPayload>): Promise<void> {
    const { ticketId, assigneeId } = event.payload;
    await this.notify(event, assigneeId, {
      type: event.eventType,
      title: "A ticket was assigned to you",
      link: `/support/tickets/${ticketId}`,
    });
  }

  @OnEvent("opportunity.won")
  async onOpportunityWon(event: DomainEvent<"opportunity.won", OpportunityOutcomePayload>): Promise<void> {
    const { opportunityId, ownerId } = event.payload;
    await this.notify(event, ownerId, {
      type: event.eventType,
      title: "Your opportunity was won",
      link: `/sales/opportunities/${opportunityId}`,
    });
  }

  @OnEvent("opportunity.lost")
  async onOpportunityLost(event: DomainEvent<"opportunity.lost", OpportunityOutcomePayload>): Promise<void> {
    const { opportunityId, ownerId } = event.payload;
    await this.notify(event, ownerId, {
      type: event.eventType,
      title: "Your opportunity was lost",
      link: `/sales/opportunities/${opportunityId}`,
    });
  }

  @OnEvent("quote.accepted")
  async onQuoteAccepted(event: DomainEvent<"quote.accepted", QuoteOutcomePayload>): Promise<void> {
    const { quoteId, ownerId } = event.payload;
    await this.notify(event, ownerId, {
      type: event.eventType,
      title: "Your quote was accepted",
      link: `/quotes/${quoteId}`,
    });
  }

  @OnEvent("quote.rejected")
  async onQuoteRejected(event: DomainEvent<"quote.rejected", QuoteOutcomePayload>): Promise<void> {
    const { quoteId, ownerId } = event.payload;
    await this.notify(event, ownerId, {
      type: event.eventType,
      title: "Your quote was rejected",
      link: `/quotes/${quoteId}`,
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
