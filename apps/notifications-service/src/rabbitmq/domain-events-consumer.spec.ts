import { ConfigService } from "@nestjs/config";
import amqp from "amqplib";
import type { DomainEvent } from "@sales-platform/contracts";
import { DomainEventsConsumer } from "./domain-events-consumer";

jest.mock("amqplib");

function makeConfig(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] } as unknown as ConfigService<never, true>;
}

function asHandleMessage(consumer: DomainEventsConsumer) {
  const withPrivate = consumer as unknown as {
    handleMessage: (channel: unknown, msg: unknown, onMessage: (event: DomainEvent) => Promise<void>) => Promise<void>;
  };
  return withPrivate.handleMessage.bind(withPrivate);
}

function makeFakeConnection() {
  const channel = {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    prefetch: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue({ consumerTag: "test" }),
    ack: jest.fn(),
    nack: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const connection = {
    createChannel: jest.fn().mockResolvedValue(channel),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return { connection, channel };
}

const sampleEvent: DomainEvent = {
  eventId: "11111111-1111-1111-1111-111111111111",
  eventType: "ticket.assigned",
  timestamp: "2026-08-22T00:00:00.000Z",
  organizationId: "22222222-2222-2222-2222-222222222222",
  correlationId: "33333333-3333-3333-3333-333333333333",
  payload: { ticketId: "tk_1", assigneeId: "user_1" },
};

const ROUTING_KEYS = ["ticket.assigned", "opportunity.won", "opportunity.lost", "quote.accepted", "quote.rejected", "payment.succeeded", "payment.failed"];

describe("DomainEventsConsumer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("startConsuming", () => {
    it("declares the same domain.events exchange/DLX apps/api's audit consumer uses, but binds only the given routing keys — never the '#' wildcard", async () => {
      const { connection, channel } = makeFakeConnection();
      (amqp.connect as jest.Mock).mockResolvedValue(connection);

      const consumer = new DomainEventsConsumer(makeConfig({ RABBITMQ_URL: "amqp://localhost:5673" }));
      await consumer.startConsuming(ROUTING_KEYS, jest.fn());

      expect(channel.assertExchange).toHaveBeenCalledWith("domain.events", "topic", { durable: true });
      expect(channel.assertExchange).toHaveBeenCalledWith("domain.events.dlx", "fanout", { durable: true });
      expect(channel.assertQueue).toHaveBeenCalledWith("notifications.service.consumer.dlq", { durable: true });
      expect(channel.assertQueue).toHaveBeenCalledWith(
        "notifications.service.consumer",
        expect.objectContaining({ durable: true, deadLetterExchange: "domain.events.dlx" }),
      );
      for (const key of ROUTING_KEYS) {
        expect(channel.bindQueue).toHaveBeenCalledWith("notifications.service.consumer", "domain.events", key);
      }
      expect(channel.bindQueue).not.toHaveBeenCalledWith("notifications.service.consumer", "domain.events", "#");
      expect(channel.prefetch).toHaveBeenCalledWith(1);
      expect(channel.consume).toHaveBeenCalledWith("notifications.service.consumer", expect.any(Function));
    });
  });

  describe("message handling", () => {
    it("acks after onMessage succeeds", async () => {
      const { channel } = makeFakeConnection();
      const consumer = new DomainEventsConsumer(makeConfig({}));
      const msg = { content: Buffer.from(JSON.stringify(sampleEvent)) } as never;
      const onMessage = jest.fn().mockResolvedValue(undefined);

      await asHandleMessage(consumer)(channel, msg, onMessage);

      expect(onMessage).toHaveBeenCalledWith(sampleEvent);
      expect(channel.ack).toHaveBeenCalledWith(msg);
      expect(channel.nack).not.toHaveBeenCalled();
    });

    it("nacks without requeue (dead-letters) when onMessage throws", async () => {
      const { channel } = makeFakeConnection();
      const consumer = new DomainEventsConsumer(makeConfig({}));
      const msg = { content: Buffer.from(JSON.stringify(sampleEvent)) } as never;
      const onMessage = jest.fn().mockRejectedValue(new Error("db down"));

      await asHandleMessage(consumer)(channel, msg, onMessage);

      expect(channel.ack).not.toHaveBeenCalled();
      expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    });
  });
});
