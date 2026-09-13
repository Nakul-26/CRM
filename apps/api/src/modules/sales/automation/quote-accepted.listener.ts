import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OnEvent } from "@nestjs/event-emitter";
import type { ApiEnv } from "@sales-platform/config";
import type { DomainEvent } from "@sales-platform/contracts";
import { RabbitMQDomainEventConsumer } from "../../../shared/events/rabbitmq-domain-event-consumer";
import { OpportunitiesService } from "../opportunities/opportunities.service";

interface QuoteAcceptedPayload {
  quoteId: string;
  accountId: string;
  opportunityId?: string | null;
}

const QUEUE_NAME = "quote-accepted-automation.consumer";
const ROUTING_KEYS = ["quote.accepted"];

/**
 * Phase 8 automation (docs/decisions/0008-analytics-automation-phase8-scope.md):
 * auto-advances a quote's linked Opportunity to its pipeline's win stage
 * once the quote is accepted. Lives in Sales, not Quotes — Quotes still
 * knows nothing about Sales' internals (the concern ADR 0005 decision #9
 * raised), it just publishes an event Sales reacts to. Best-effort: quote
 * acceptance is a public, unauthenticated action and must succeed
 * regardless of whether this automation runs.
 *
 * Under EVENT_BUS_TRANSPORT=rabbitmq (Phase 22, see
 * docs/decisions/0022-rabbitmq-general-adoption-phase22-scope.md), the
 * @OnEvent handler below defers to its own durable queue consumer instead
 * of running immediately in-process — this listener never publishes
 * anything itself, only consumes, to avoid double-delivering via
 * AuditListener's existing blanket republish.
 */
@Injectable()
export class QuoteAcceptedListener implements OnModuleInit {
  private readonly logger = new Logger(QuoteAcceptedListener.name);

  constructor(
    private readonly opportunities: OpportunitiesService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get("EVENT_BUS_TRANSPORT", { infer: true }) === "rabbitmq") {
      const consumer = new RabbitMQDomainEventConsumer(this.config, QUEUE_NAME);
      await consumer.startConsuming(ROUTING_KEYS, (event) =>
        this.handleQuoteAccepted(event as DomainEvent<"quote.accepted", QuoteAcceptedPayload>),
      );
    }
  }

  @OnEvent("quote.accepted")
  async onQuoteAccepted(event: DomainEvent<"quote.accepted", QuoteAcceptedPayload>): Promise<void> {
    if (this.config.get("EVENT_BUS_TRANSPORT", { infer: true }) === "rabbitmq") return;
    await this.handleQuoteAccepted(event);
  }

  private async handleQuoteAccepted(event: DomainEvent<"quote.accepted", QuoteAcceptedPayload>): Promise<void> {
    if (!event.payload.opportunityId) return;

    try {
      await this.opportunities.autoAdvanceOnQuoteAccepted(event.organizationId, event.payload.opportunityId);
    } catch (error) {
      this.logger.error(`Failed to auto-advance opportunity ${event.payload.opportunityId} on quote acceptance`, error as Error);
    }
  }
}
