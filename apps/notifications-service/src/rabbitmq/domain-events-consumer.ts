import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from "amqplib";
import type { NotificationsServiceEnv } from "@sales-platform/config";
import type { DomainEvent } from "@sales-platform/contracts";

const EXCHANGE = "domain.events";
const DEAD_LETTER_EXCHANGE = "domain.events.dlx";
const QUEUE = "notifications.service.consumer";
const DEAD_LETTER_QUEUE = "notifications.service.consumer.dlq";

/**
 * Consume-only counterpart to apps/api's RabbitMQAuditTransport
 * (apps/api/src/shared/audit/rabbitmq-audit-transport.ts). Binds its own
 * queue to the *same* `domain.events` topic exchange that
 * RabbitMQAuditTransport already publishes every domain event onto
 * whenever EVENT_BUS_TRANSPORT=rabbitmq — but only for the specific routing
 * keys this service cares about, rather than the audit consumer's `#`
 * wildcard. No publish side exists here at all: this service never
 * produces domain events, only consumes them. See
 * docs/decisions/0018-microservices-split-phase18-scope.md.
 */
@Injectable()
export class DomainEventsConsumer implements OnModuleDestroy {
  private readonly logger = new Logger(DomainEventsConsumer.name);

  private connection: ChannelModel | undefined;
  private consumeChannel: Channel | undefined;

  constructor(private readonly config: ConfigService<NotificationsServiceEnv, true>) {}

  async startConsuming(routingKeys: string[], onMessage: (event: DomainEvent) => Promise<void>): Promise<void> {
    const url = this.config.get("RABBITMQ_URL", { infer: true });
    const connection = await amqp.connect(url);
    connection.on("error", (error) => this.logger.error("RabbitMQ connection error", error as Error));
    connection.on("close", () => this.logger.warn("RabbitMQ connection closed"));
    this.connection = connection;

    const channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE, "topic", { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, "fanout", { durable: true });
    await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
    await channel.bindQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_EXCHANGE, "");
    await channel.assertQueue(QUEUE, { durable: true, deadLetterExchange: DEAD_LETTER_EXCHANGE });
    for (const routingKey of routingKeys) {
      await channel.bindQueue(QUEUE, EXCHANGE, routingKey);
    }
    await channel.prefetch(1);

    this.consumeChannel = channel;

    await channel.consume(QUEUE, (msg) => {
      if (!msg) return;
      void this.handleMessage(channel, msg, onMessage);
    });

    this.logger.log(`Consuming ${QUEUE} (routing keys: ${routingKeys.join(", ")})`);
  }

  private async handleMessage(channel: Channel, msg: ConsumeMessage, onMessage: (event: DomainEvent) => Promise<void>): Promise<void> {
    try {
      const event = JSON.parse(msg.content.toString("utf8")) as DomainEvent;
      await onMessage(event);
      channel.ack(msg);
    } catch (error) {
      this.logger.error("Failed to process domain event from RabbitMQ — dead-lettering", error as Error);
      channel.nack(msg, false, false);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumeChannel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
