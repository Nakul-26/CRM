import { ConfigService } from "@nestjs/config";
import amqp from "amqplib";
import type { DomainEvent } from "@sales-platform/contracts";
import { RabbitMQAuditTransport } from "./rabbitmq-audit-transport";

jest.mock("amqplib");

function makeConfig(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] } as unknown as ConfigService<never, true>;
}

// handleMessage is private — exercised directly (same idiom as the Stripe
// provider spec's `(provider as unknown as {...})` casts) rather than driving
// it indirectly through the consume() callback, to avoid timing flakiness
// around the fire-and-forget `void this.handleMessage(...)` call site.
function asHandleMessage(transport: RabbitMQAuditTransport) {
  const withPrivate = transport as unknown as {
    handleMessage: (channel: unknown, msg: unknown, onMessage: (event: DomainEvent) => Promise<void>) => Promise<void>;
  };
  return withPrivate.handleMessage.bind(withPrivate);
}

function makeFakeConnection() {
  const confirmChannel = {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    publish: jest.fn(),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
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
    createConfirmChannel: jest.fn().mockResolvedValue(confirmChannel),
    createChannel: jest.fn().mockResolvedValue(channel),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return { connection, confirmChannel, channel };
}

const sampleEvent: DomainEvent = {
  eventId: "11111111-1111-1111-1111-111111111111",
  eventType: "account.created",
  timestamp: "2026-08-22T00:00:00.000Z",
  organizationId: "22222222-2222-2222-2222-222222222222",
  correlationId: "33333333-3333-3333-3333-333333333333",
  payload: { id: "acc_1" },
};

describe("RabbitMQAuditTransport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("publishForAudit", () => {
    it("resolves true when the broker confirms the publish", async () => {
      const { connection, confirmChannel } = makeFakeConnection();
      confirmChannel.publish.mockImplementation((_ex, _rk, _buf, _opts, cb: (err: unknown) => void) => {
        cb(null);
        return true;
      });
      (amqp.connect as jest.Mock).mockResolvedValue(connection);

      const transport = new RabbitMQAuditTransport(makeConfig({ RABBITMQ_URL: "amqp://localhost:5673" }));
      await expect(transport.publishForAudit(sampleEvent)).resolves.toBe(true);
      expect(confirmChannel.publish).toHaveBeenCalledWith(
        "domain.events",
        "account.created",
        Buffer.from(JSON.stringify(sampleEvent)),
        expect.objectContaining({ persistent: true }),
        expect.any(Function),
      );
    });

    it("resolves false when the broker nacks the publish", async () => {
      const { connection, confirmChannel } = makeFakeConnection();
      confirmChannel.publish.mockImplementation((_ex, _rk, _buf, _opts, cb: (err: unknown) => void) => {
        cb(new Error("nacked"));
        return true;
      });
      (amqp.connect as jest.Mock).mockResolvedValue(connection);

      const transport = new RabbitMQAuditTransport(makeConfig({ RABBITMQ_URL: "amqp://localhost:5673" }));
      await expect(transport.publishForAudit(sampleEvent)).resolves.toBe(false);
    });

    it("resolves false (never throws) when RABBITMQ_URL is not configured", async () => {
      const transport = new RabbitMQAuditTransport(makeConfig({}));
      await expect(transport.publishForAudit(sampleEvent)).resolves.toBe(false);
      expect(amqp.connect).not.toHaveBeenCalled();
    });

    it("resolves false (never throws) when the connection attempt itself fails", async () => {
      (amqp.connect as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED"));
      const transport = new RabbitMQAuditTransport(makeConfig({ RABBITMQ_URL: "amqp://localhost:5673" }));
      await expect(transport.publishForAudit(sampleEvent)).resolves.toBe(false);
    });
  });

  describe("startConsuming", () => {
    it("declares the exchange/DLQ/queue topology and binds with the catch-all routing key", async () => {
      const { connection, channel } = makeFakeConnection();
      (amqp.connect as jest.Mock).mockResolvedValue(connection);

      const transport = new RabbitMQAuditTransport(makeConfig({ RABBITMQ_URL: "amqp://localhost:5673" }));
      await transport.startConsuming(jest.fn());

      expect(channel.assertExchange).toHaveBeenCalledWith("domain.events", "topic", { durable: true });
      expect(channel.assertExchange).toHaveBeenCalledWith("domain.events.dlx", "fanout", { durable: true });
      expect(channel.assertQueue).toHaveBeenCalledWith("audit.log.consumer.dlq", { durable: true });
      expect(channel.assertQueue).toHaveBeenCalledWith(
        "audit.log.consumer",
        expect.objectContaining({ durable: true, deadLetterExchange: "domain.events.dlx" }),
      );
      expect(channel.bindQueue).toHaveBeenCalledWith("audit.log.consumer", "domain.events", "#");
      expect(channel.prefetch).toHaveBeenCalledWith(1);
      expect(channel.consume).toHaveBeenCalledWith("audit.log.consumer", expect.any(Function));
    });
  });

  describe("message handling", () => {
    it("acks after onMessage succeeds", async () => {
      const { channel } = makeFakeConnection();
      const transport = new RabbitMQAuditTransport(makeConfig({}));
      const msg = { content: Buffer.from(JSON.stringify(sampleEvent)) } as never;
      const onMessage = jest.fn().mockResolvedValue(undefined);

      await asHandleMessage(transport)(channel, msg, onMessage);

      expect(onMessage).toHaveBeenCalledWith(sampleEvent);
      expect(channel.ack).toHaveBeenCalledWith(msg);
      expect(channel.nack).not.toHaveBeenCalled();
    });

    it("nacks without requeue (dead-letters) when onMessage throws", async () => {
      const { channel } = makeFakeConnection();
      const transport = new RabbitMQAuditTransport(makeConfig({}));
      const msg = { content: Buffer.from(JSON.stringify(sampleEvent)) } as never;
      const onMessage = jest.fn().mockRejectedValue(new Error("db down"));

      await asHandleMessage(transport)(channel, msg, onMessage);

      expect(channel.ack).not.toHaveBeenCalled();
      expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    });
  });
});
