import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { DomainEvent } from "@sales-platform/contracts";
import { RequestContextService } from "../context/request-context";

type PublishInput<TType extends string, TPayload> = {
  eventType: TType;
  payload: TPayload;
  organizationId?: string;
  actorId?: string;
  correlationId?: string;
};

/**
 * Delivered in-process via EventEmitter2 in Phase 1 (see ADR 0001). The
 * publish contract intentionally matches what a RabbitMQ-backed bus would
 * look like, so swapping the transport later doesn't change producers or
 * consumers — only this class's internals.
 */
@Injectable()
export class DomainEventBus {
  constructor(
    private readonly emitter: EventEmitter2,
    private readonly context: RequestContextService,
  ) {}

  publish<TType extends string, TPayload>(input: PublishInput<TType, TPayload>): DomainEvent<TType, TPayload> {
    const ctx = this.context.getOrNull();

    const organizationId = input.organizationId ?? ctx?.organizationId;
    if (!organizationId) {
      throw new Error(`Cannot publish "${input.eventType}" without an organizationId`);
    }

    const event: DomainEvent<TType, TPayload> = {
      eventId: randomUUID(),
      eventType: input.eventType,
      timestamp: new Date().toISOString(),
      organizationId,
      actorId: input.actorId ?? ctx?.userId,
      correlationId: input.correlationId ?? ctx?.correlationId ?? randomUUID(),
      payload: input.payload,
    };

    // Wildcard emit so cross-cutting listeners (audit) don't need to know
    // every event type in advance; type-specific emit for feature listeners.
    this.emitter.emit(event.eventType, event);
    this.emitter.emit("domain.event", event);

    return event;
  }
}
