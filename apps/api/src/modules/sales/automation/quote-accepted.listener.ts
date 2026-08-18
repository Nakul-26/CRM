import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { DomainEvent } from "@sales-platform/contracts";
import { OpportunitiesService } from "../opportunities/opportunities.service";

interface QuoteAcceptedPayload {
  quoteId: string;
  accountId: string;
  opportunityId?: string | null;
}

/**
 * Phase 8 automation (docs/decisions/0008-analytics-automation-phase8-scope.md):
 * auto-advances a quote's linked Opportunity to its pipeline's win stage
 * once the quote is accepted. Lives in Sales, not Quotes — Quotes still
 * knows nothing about Sales' internals (the concern ADR 0005 decision #9
 * raised), it just publishes an event Sales reacts to. Best-effort: quote
 * acceptance is a public, unauthenticated action and must succeed
 * regardless of whether this automation runs.
 */
@Injectable()
export class QuoteAcceptedListener {
  private readonly logger = new Logger(QuoteAcceptedListener.name);

  constructor(private readonly opportunities: OpportunitiesService) {}

  @OnEvent("quote.accepted")
  async onQuoteAccepted(event: DomainEvent<"quote.accepted", QuoteAcceptedPayload>): Promise<void> {
    if (!event.payload.opportunityId) return;

    try {
      await this.opportunities.autoAdvanceOnQuoteAccepted(event.organizationId, event.payload.opportunityId);
    } catch (error) {
      this.logger.error(`Failed to auto-advance opportunity ${event.payload.opportunityId} on quote acceptance`, error as Error);
    }
  }
}
