import { Inject, Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { DomainEvent } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../database/database.module";
import { auditLog } from "../../database/schema";
import { RequestContextService } from "../context/request-context";

/**
 * Every domain event is, by construction, an important business action
 * (Section 14 of the brief) — so rather than hand-annotating controllers,
 * every published event is appended to the audit log automatically.
 */
@Injectable()
export class AuditListener {
  private readonly logger = new Logger(AuditListener.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly context: RequestContextService,
  ) {}

  @OnEvent("domain.event")
  async handle(event: DomainEvent): Promise<void> {
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
    } catch (error) {
      // Audit logging must never break the business operation that
      // triggered it — log and move on rather than throwing.
      this.logger.error(`Failed to write audit log for event "${event.eventType}"`, error as Error);
    }
  }
}
