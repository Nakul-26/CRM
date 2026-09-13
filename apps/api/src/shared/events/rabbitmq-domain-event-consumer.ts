import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from "amqplib";
import type { ApiEnv } from "@sales-platform/config";
import type { DomainEvent } from "@sales-platform/contracts";

const EXCHANGE = "domain.events";
const DEAD_LETTER_EXCHANGE = "domain.events.dlx";

/**
 * Generic, queue-name-parameterized consume-only counterpart to
 * RabbitMQAuditTransport (apps/api/src/shared/audit/rabbitmq-audit-transport.ts).
 * Binds its own queue to the same `domain.events` topic exchange that
 * RabbitMQAuditTransport already republishes every domain event onto
 * whenever EVENT_BUS_TRANSPORT=rabbitmq — but only for the specific routing
 * keys the caller asks for, never the audit consumer's `#` wildcard. No
 * publish side exists here: a listener built on this class must never also
 * publish, or the same event would be redelivered twice onto the exchange
 * (once via AuditListener's blanket republish, once via its own) — see
 * docs/decisions/0022-rabbitmq-general-adoption-phase22-scope.md. One
 * instance per listener, each with its own connection (mirrors
 * apps/notifications-service's DomainEventsConsumer, which independently
 * duplicates this same shape for its own queue).
 */
export class RabbitMQDomainEventConsumer {
  private readonly logger: Logger;

  private connection: ChannelModel | undefined;
  private consumeChannel: Channel | undefined;

  constructor(
    private readonly config: ConfigService<ApiEnv, true>,
    private readonly queueName: string,
  ) {
    this.logger = new Logger(`RabbitMQDomainEventConsumer(${queueName})`);
  }

  async startConsuming(routingKeys: string[], onMessage: (event: DomainEvent) => Promise<void>): Promise<void> {
    const url = this.config.get("RABBITMQ_URL", { infer: true });
    if (!url) {
      throw new Error("EVENT_BUS_TRANSPORT=rabbitmq requires RABBITMQ_URL to be set");
    }

    const connection = await amqp.connect(url);
    connection.on("error", (error) => this.logger.error("RabbitMQ connection error", error as Error));
    connection.on("close", () => this.logger.warn("RabbitMQ connection closed"));
    this.connection = connection;

    const channel = await connection.createChannel();
    const deadLetterQueue = `${this.queueName}.dlq`;
    await channel.assertExchange(EXCHANGE, "topic", { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, "fanout", { durable: true });
    await channel.assertQueue(deadLetterQueue, { durable: true });
    await channel.bindQueue(deadLetterQueue, DEAD_LETTER_EXCHANGE, "");
    await channel.assertQueue(this.queueName, { durable: true, deadLetterExchange: DEAD_LETTER_EXCHANGE });
    for (const routingKey of routingKeys) {
      await channel.bindQueue(this.queueName, EXCHANGE, routingKey);
    }
    await channel.prefetch(1);

    this.consumeChannel = channel;

    await channel.consume(this.queueName, (msg) => {
      if (!msg) return;
      void this.handleMessage(channel, msg, onMessage);
    });

    this.logger.log(`Consuming ${this.queueName} (routing keys: ${routingKeys.join(", ")})`);
  }

  private async handleMessage(
    channel: Channel,
    msg: ConsumeMessage,
    onMessage: (event: DomainEvent) => Promise<void>,
  ): Promise<void> {
    try {
      const event = JSON.parse(msg.content.toString("utf8")) as DomainEvent;
      await onMessage(event);
      channel.ack(msg);
    } catch (error) {
      this.logger.error(`Failed to process event from RabbitMQ queue "${this.queueName}" — dead-lettering`, error as Error);
      channel.nack(msg, false, false);
    }
  }

  async close(): Promise<void> {
    await this.consumeChannel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
