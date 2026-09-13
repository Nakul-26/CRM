import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@sales-platform/config";
import type { DomainEvent } from "@sales-platform/contracts";
import { QuoteAcceptedListener } from "./quote-accepted.listener";
import { OpportunitiesService } from "../opportunities/opportunities.service";
import { RabbitMQDomainEventConsumer } from "../../../shared/events/rabbitmq-domain-event-consumer";

jest.mock("../../../shared/events/rabbitmq-domain-event-consumer");

function makeConfig(transport: "in-process" | "rabbitmq") {
  return { get: () => transport } as unknown as ConfigService<ApiEnv, true>;
}

function makeOpportunities() {
  return { autoAdvanceOnQuoteAccepted: jest.fn().mockResolvedValue(undefined) } as unknown as OpportunitiesService;
}

const quoteAcceptedEvent: DomainEvent<"quote.accepted", { quoteId: string; accountId: string; opportunityId?: string | null }> = {
  eventId: "11111111-1111-1111-1111-111111111111",
  eventType: "quote.accepted",
  timestamp: "2026-08-22T00:00:00.000Z",
  organizationId: "22222222-2222-2222-2222-222222222222",
  correlationId: "33333333-3333-3333-3333-333333333333",
  payload: { quoteId: "q_1", accountId: "acc_1", opportunityId: "opp_1" },
};

describe("QuoteAcceptedListener", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("auto-advances directly when the transport is in-process (default)", async () => {
    const opportunities = makeOpportunities();
    const listener = new QuoteAcceptedListener(opportunities, makeConfig("in-process"));

    await listener.onQuoteAccepted(quoteAcceptedEvent);

    expect(opportunities.autoAdvanceOnQuoteAccepted).toHaveBeenCalledWith(quoteAcceptedEvent.organizationId, "opp_1");
  });

  it("skips advancing directly when the transport is rabbitmq, deferring to its own consumer", async () => {
    const opportunities = makeOpportunities();
    const listener = new QuoteAcceptedListener(opportunities, makeConfig("rabbitmq"));

    await listener.onQuoteAccepted(quoteAcceptedEvent);

    expect(opportunities.autoAdvanceOnQuoteAccepted).not.toHaveBeenCalled();
  });

  it("starts consuming from RabbitMQ on module init only when the transport is rabbitmq, bound only to quote.accepted", async () => {
    const startConsuming = jest.fn().mockResolvedValue(undefined);
    (RabbitMQDomainEventConsumer as jest.Mock).mockImplementation(() => ({ startConsuming }));

    const listenerOn = new QuoteAcceptedListener(makeOpportunities(), makeConfig("rabbitmq"));
    await listenerOn.onModuleInit();
    expect(RabbitMQDomainEventConsumer).toHaveBeenCalledWith(expect.anything(), "quote-accepted-automation.consumer");
    expect(startConsuming).toHaveBeenCalledWith(["quote.accepted"], expect.any(Function));

    jest.clearAllMocks();
    (RabbitMQDomainEventConsumer as jest.Mock).mockImplementation(() => ({ startConsuming }));
    const listenerOff = new QuoteAcceptedListener(makeOpportunities(), makeConfig("in-process"));
    await listenerOff.onModuleInit();
    expect(RabbitMQDomainEventConsumer).not.toHaveBeenCalled();
  });

  it("the queue consumer callback dispatches a quote.accepted message to the same auto-advance logic", async () => {
    let capturedOnMessage: ((event: DomainEvent) => Promise<void>) | undefined;
    (RabbitMQDomainEventConsumer as jest.Mock).mockImplementation(() => ({
      startConsuming: jest.fn().mockImplementation(async (_routingKeys: string[], onMessage: (event: DomainEvent) => Promise<void>) => {
        capturedOnMessage = onMessage;
      }),
    }));
    const opportunities = makeOpportunities();
    const listener = new QuoteAcceptedListener(opportunities, makeConfig("rabbitmq"));
    await listener.onModuleInit();

    await capturedOnMessage?.(quoteAcceptedEvent);

    expect(opportunities.autoAdvanceOnQuoteAccepted).toHaveBeenCalledWith(quoteAcceptedEvent.organizationId, "opp_1");
  });
});
