import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@sales-platform/config";
import type { DomainEvent } from "@sales-platform/contracts";
import { MailListener } from "./mail.listener";
import { MailerService } from "./mailer.service";
import { RabbitMQDomainEventConsumer } from "../events/rabbitmq-domain-event-consumer";

jest.mock("../events/rabbitmq-domain-event-consumer");

function makeConfig(transport: "in-process" | "rabbitmq") {
  return { get: () => transport } as unknown as ConfigService<ApiEnv, true>;
}

function makeMailer() {
  return { send: jest.fn().mockResolvedValue(undefined) } as unknown as MailerService;
}

const quoteSentEvent: DomainEvent<"quote.sent", { quoteId: string; contactEmail?: string | null }> = {
  eventId: "11111111-1111-1111-1111-111111111111",
  eventType: "quote.sent",
  timestamp: "2026-08-22T00:00:00.000Z",
  organizationId: "22222222-2222-2222-2222-222222222222",
  correlationId: "33333333-3333-3333-3333-333333333333",
  payload: { quoteId: "q_1", contactEmail: "customer@example.com" },
};

describe("MailListener", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sends directly when the transport is in-process (default)", async () => {
    const mailer = makeMailer();
    const listener = new MailListener(mailer, makeConfig("in-process"));

    await listener.onQuoteSent(quoteSentEvent);

    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it("skips sending directly when the transport is rabbitmq, deferring to its own consumer", async () => {
    const mailer = makeMailer();
    const listener = new MailListener(mailer, makeConfig("rabbitmq"));

    await listener.onQuoteSent(quoteSentEvent);

    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("starts consuming from RabbitMQ on module init only when the transport is rabbitmq", async () => {
    const startConsuming = jest.fn().mockResolvedValue(undefined);
    (RabbitMQDomainEventConsumer as jest.Mock).mockImplementation(() => ({ startConsuming }));

    const listenerOn = new MailListener(makeMailer(), makeConfig("rabbitmq"));
    await listenerOn.onModuleInit();
    expect(RabbitMQDomainEventConsumer).toHaveBeenCalledWith(expect.anything(), "mail.consumer");
    expect(startConsuming).toHaveBeenCalledWith(
      ["quote.sent", "ticket.created", "ticket.comment_added", "subscription.renewal_reminder_sent"],
      expect.any(Function),
    );

    jest.clearAllMocks();
    (RabbitMQDomainEventConsumer as jest.Mock).mockImplementation(() => ({ startConsuming }));
    const listenerOff = new MailListener(makeMailer(), makeConfig("in-process"));
    await listenerOff.onModuleInit();
    expect(RabbitMQDomainEventConsumer).not.toHaveBeenCalled();
  });

  it("the queue consumer callback dispatches a quote.sent message to the same send logic", async () => {
    let capturedOnMessage: ((event: DomainEvent) => Promise<void>) | undefined;
    (RabbitMQDomainEventConsumer as jest.Mock).mockImplementation(() => ({
      startConsuming: jest.fn().mockImplementation(async (_routingKeys: string[], onMessage: (event: DomainEvent) => Promise<void>) => {
        capturedOnMessage = onMessage;
      }),
    }));
    const mailer = makeMailer();
    const listener = new MailListener(mailer, makeConfig("rabbitmq"));
    await listener.onModuleInit();

    await capturedOnMessage?.(quoteSentEvent);

    expect(mailer.send).toHaveBeenCalledTimes(1);
  });
});
