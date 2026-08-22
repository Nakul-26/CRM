import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import type { ApiEnv } from "@sales-platform/config";
import type { DomainEvent } from "@sales-platform/contracts";
import { AUDIT_LOG_ENTRY_CREATED_EVENT, type AuditStreamEvent } from "../../modules/identity/audit/audit-stream";
import { DATABASE_CONNECTION, type Database } from "../../database/database.module";
import { auditLog } from "../../database/schema";
import { RequestContextService } from "../context/request-context";
import { RabbitMQAuditTransport } from "./rabbitmq-audit-transport";

/**
 * Every domain event is, by construction, an important business action
 * (Section 14 of the brief) — so rather than hand-annotating controllers,
 * every published event is appended to the audit log automatically.
 */
@Injectable()
export class AuditListener implements OnModuleInit {
  private readonly logger = new Logger(AuditListener.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly context: RequestContextService,
    private readonly emitter: EventEmitter2,
    private readonly config: ConfigService<ApiEnv, true>,
    private readonly rabbit: RabbitMQAuditTransport,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get("EVENT_BUS_TRANSPORT", { infer: true }) === "rabbitmq") {
      await this.rabbit.startConsuming((event) => this.writeAuditEntry(event));
    }
  }

  /**
   * Under EVENT_BUS_TRANSPORT=rabbitmq, hand the event to a durable queue
   * instead of writing it directly — a dropped DB insert then becomes a
   * retryable/dead-lettered queue message rather than silently lost data.
   * Any failure to even get a broker confirm (broker down, timeout, etc.)
   * falls straight through to the direct write below, so switching this
   * transport on can only ever add a durability path, never regress.
   */
  @OnEvent("domain.event")
  async handleDomainEvent(event: DomainEvent): Promise<void> {
    if (this.config.get("EVENT_BUS_TRANSPORT", { infer: true }) === "rabbitmq") {
      const confirmed = await this.rabbit.publishForAudit(event);
      if (confirmed) return;
    }
    await this.writeAuditEntry(event);
  }

  async writeAuditEntry(event: DomainEvent): Promise<void> {
    const ctx = this.context.getOrNull();

    try {
      await this.db.insert(auditLog).values({
        organizationId: event.organizationId,
        actorId: event.actorId ?? null,
        eventType: event.eventType,
        payload: event.payload as Record<string, unknown>,
        requestId: ctx?.requestId ?? null,
        correlationId: event.correlationId,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
      });

      this.emitter.emit(AUDIT_LOG_ENTRY_CREATED_EVENT, {
        organizationId: event.organizationId,
        eventType: event.eventType,
        actorId: event.actorId ?? null,
        createdAt: new Date().toISOString(),
      } satisfies AuditStreamEvent);
    } catch (error) {
      // Audit logging must never break the business operation that
      // triggered it — log and move on rather than throwing.
      this.logger.error(`Failed to write audit log for event "${event.eventType}"`, error as Error);
    }
  }
}
