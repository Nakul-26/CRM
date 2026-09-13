import { ConfigService } from "@nestjs/config";
import amqp from "amqplib";
import type { ApiEnv } from "@sales-platform/config";
import type { DomainEvent } from "@sales-platform/contracts";
import { RabbitMQDomainEventConsumer } from "./rabbitmq-domain-event-consumer";

jest.mock("amqplib");

function makeConfig(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] } as unknown as ConfigService<ApiEnv, true>;
}

function asHandleMessage(consumer: RabbitMQDomainEventConsumer) {
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
  eventType: "quote.sent",
  timestamp: "2026-08-22T00:00:00.000Z",
  organizationId: "22222222-2222-2222-2222-222222222222",
  correlationId: "33333333-3333-3333-3333-333333333333",
  payload: { quoteId: "q_1" },
};

describe("RabbitMQDomainEventConsumer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("startConsuming", () => {
    it("declares the shared domain.events exchange/DLX but binds only the given routing keys to its own queue name — never '#'", async () => {
      const { connection, channel } = makeFakeConnection();
      (amqp.connect as jest.Mock).mockResolvedValue(connection);

      const consumer = new RabbitMQDomainEventConsumer(makeConfig({ RABBITMQ_URL: "amqp://guest:guest@localhost:5673" }), "mail.consumer");
      const routingKeys = ["quote.sent", "ticket.created"];
      await consumer.startConsuming(routingKeys, jest.fn());

      expect(channel.assertExchange).toHaveBeenCalledWith("domain.events", "topic", { durable: true });
      expect(channel.assertExchange).toHaveBeenCalledWith("domain.events.dlx", "fanout", { durable: true });
      expect(channel.assertQueue).toHaveBeenCalledWith("mail.consumer.dlq", { durable: true });
      expect(channel.assertQueue).toHaveBeenCalledWith("mail.consumer", expect.objectContaining({ durable: true, deadLetterExchange: "domain.events.dlx" }));
      for (const key of routingKeys) {
        expect(channel.bindQueue).toHaveBeenCalledWith("mail.consumer", "domain.events", key);
      }
      expect(channel.bindQueue).not.toHaveBeenCalledWith("mail.consumer", "domain.events", "#");
      expect(channel.prefetch).toHaveBeenCalledWith(1);
      expect(channel.consume).toHaveBeenCalledWith("mail.consumer", expect.any(Function));
    });

    it("throws if RABBITMQ_URL is not set", async () => {
      const consumer = new RabbitMQDomainEventConsumer(makeConfig({}), "mail.consumer");
      await expect(consumer.startConsuming(["quote.sent"], jest.fn())).rejects.toThrow("RABBITMQ_URL");
    });

    it("uses a distinct queue name per instance, so two listeners never collide", async () => {
      const { connection: connection1, channel: channel1 } = makeFakeConnection();
      const { connection: connection2, channel: channel2 } = makeFakeConnection();
      (amqp.connect as jest.Mock).mockResolvedValueOnce(connection1).mockResolvedValueOnce(connection2);

      const mailConsumer = new RabbitMQDomainEventConsumer(makeConfig({ RABBITMQ_URL: "amqp://guest:guest@localhost:5673" }), "mail.consumer");
      const notificationsConsumer = new RabbitMQDomainEventConsumer(
        makeConfig({ RABBITMQ_URL: "amqp://guest:guest@localhost:5673" }),
        "notifications.monolith.consumer",
      );

      await mailConsumer.startConsuming(["quote.sent"], jest.fn());
      await notificationsConsumer.startConsuming(["ticket.assigned"], jest.fn());

      expect(channel1.assertQueue).toHaveBeenCalledWith("mail.consumer", expect.anything());
      expect(channel2.assertQueue).toHaveBeenCalledWith("notifications.monolith.consumer", expect.anything());
    });
  });

  describe("message handling", () => {
    it("acks after onMessage succeeds", async () => {
      const { channel } = makeFakeConnection();
      const consumer = new RabbitMQDomainEventConsumer(makeConfig({}), "mail.consumer");
      const msg = { content: Buffer.from(JSON.stringify(sampleEvent)) } as never;
      const onMessage = jest.fn().mockResolvedValue(undefined);

      await asHandleMessage(consumer)(channel, msg, onMessage);

      expect(onMessage).toHaveBeenCalledWith(sampleEvent);
      expect(channel.ack).toHaveBeenCalledWith(msg);
      expect(channel.nack).not.toHaveBeenCalled();
    });

    it("nacks without requeue (dead-letters) when onMessage throws", async () => {
      const { channel } = makeFakeConnection();
      const consumer = new RabbitMQDomainEventConsumer(makeConfig({}), "mail.consumer");
      const msg = { content: Buffer.from(JSON.stringify(sampleEvent)) } as never;
      const onMessage = jest.fn().mockRejectedValue(new Error("smtp down"));

      await asHandleMessage(consumer)(channel, msg, onMessage);

      expect(channel.ack).not.toHaveBeenCalled();
      expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    });
  });
});
