import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import amqp, { type Channel, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from "amqplib";
import type { ApiEnv } from "@sales-platform/config";
import type { DomainEvent } from "@sales-platform/contracts";

const EXCHANGE = "domain.events";
const DEAD_LETTER_EXCHANGE = "domain.events.dlx";
const QUEUE = "audit.log.consumer";
const DEAD_LETTER_QUEUE = "audit.log.consumer.dlq";
const CONFIRM_TIMEOUT_MS = 3000;

/**
 * Pure transport plumbing for moving DomainEvent envelopes through RabbitMQ —
 * no audit-domain knowledge lives here (see AuditListener for that). Only
 * ever touched when EVENT_BUS_TRANSPORT=rabbitmq; the connection is built
 * lazily on first use so the default in-process transport never requires
 * RABBITMQ_URL to be set or a broker to be reachable. See
 * docs/decisions/0014-rabbitmq-audit-transport-phase14-scope.md.
 */
@Injectable()
export class RabbitMQAuditTransport implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQAuditTransport.name);

  private connection: ChannelModel | undefined;
  private connecting: Promise<ChannelModel> | undefined;
  private publishChannel: ConfirmChannel | undefined;
  private consumeChannel: Channel | undefined;

  constructor(private readonly config: ConfigService<ApiEnv, true>) {}

  /**
   * Publishes to the durable exchange and waits for the broker's confirm.
   * Resolves false (never rejects) on any connection error, nack, or
   * timeout — callers treat that as "not queued" and fall back to writing
   * directly instead.
   */
  async publishForAudit(event: DomainEvent): Promise<boolean> {
    try {
      const channel = await this.getPublishChannel();
      return await new Promise<boolean>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(false);
        }, CONFIRM_TIMEOUT_MS);

        channel.publish(
          EXCHANGE,
          event.eventType,
          Buffer.from(JSON.stringify(event)),
          { persistent: true, contentType: "application/json" },
          (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(!err);
          },
        );
      });
    } catch (error) {
      this.logger.error(`Failed to publish audit event "${event.eventType}" to RabbitMQ`, error as Error);
      return false;
    }
  }

  /** Begins consuming the durable audit queue; ack on success, dead-letter on failure. */
  async startConsuming(onMessage: (event: DomainEvent) => Promise<void>): Promise<void> {
    const model = await this.getConnection();
    const channel = await model.createChannel();
    await channel.assertExchange(EXCHANGE, "topic", { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, "fanout", { durable: true });
    await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
    await channel.bindQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_EXCHANGE, "");
    await channel.assertQueue(QUEUE, { durable: true, deadLetterExchange: DEAD_LETTER_EXCHANGE });
    await channel.bindQueue(QUEUE, EXCHANGE, "#");
    await channel.prefetch(1);

    this.consumeChannel = channel;

    await channel.consume(QUEUE, (msg) => {
      if (!msg) return;
      void this.handleMessage(channel, msg, onMessage);
    });
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
      this.logger.error("Failed to process audit event from RabbitMQ — dead-lettering", error as Error);
      channel.nack(msg, false, false);
    }
  }

  private async getPublishChannel(): Promise<ConfirmChannel> {
    if (this.publishChannel) return this.publishChannel;
    const model = await this.getConnection();
    const channel = await model.createConfirmChannel();
    await channel.assertExchange(EXCHANGE, "topic", { durable: true });
    channel.on("error", (error) => this.logger.error("RabbitMQ publish channel error", error as Error));
    channel.on("close", () => {
      if (this.publishChannel === channel) this.publishChannel = undefined;
    });
    this.publishChannel = channel;
    return channel;
  }

  private async getConnection(): Promise<ChannelModel> {
    if (this.connection) return this.connection;
    if (this.connecting) return this.connecting;

    const url = this.config.get("RABBITMQ_URL", { infer: true });
    if (!url) {
      throw new Error("EVENT_BUS_TRANSPORT=rabbitmq requires RABBITMQ_URL to be set");
    }

    this.connecting = amqp
      .connect(url)
      .then((connection) => {
        connection.on("error", (error) => this.logger.error("RabbitMQ connection error", error as Error));
        connection.on("close", () => {
          this.logger.warn("RabbitMQ connection closed");
          if (this.connection === connection) this.connection = undefined;
          this.publishChannel = undefined;
          this.consumeChannel = undefined;
        });
        this.connection = connection;
        return connection;
      })
      .finally(() => {
        this.connecting = undefined;
      });

    return this.connecting;
  }

  async onModuleDestroy(): Promise<void> {
    await this.publishChannel?.close().catch(() => undefined);
    await this.consumeChannel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
