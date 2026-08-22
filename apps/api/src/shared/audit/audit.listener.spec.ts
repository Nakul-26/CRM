import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { DomainEvent } from "@sales-platform/contracts";
import { AuditListener } from "./audit.listener";
import { RabbitMQAuditTransport } from "./rabbitmq-audit-transport";
import { RequestContextService } from "../context/request-context";

function makeConfig(transport: "in-process" | "rabbitmq") {
  return { get: () => transport } as unknown as ConfigService<never, true>;
}

function makeDb() {
  const values = jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn().mockReturnValue({ values });
  return { db: { insert } as never, values };
}

const sampleEvent: DomainEvent = {
  eventId: "11111111-1111-1111-1111-111111111111",
  eventType: "account.created",
  timestamp: "2026-08-22T00:00:00.000Z",
  organizationId: "22222222-2222-2222-2222-222222222222",
  correlationId: "33333333-3333-3333-3333-333333333333",
  payload: { id: "acc_1" },
};

describe("AuditListener", () => {
  it("writes directly when the transport is in-process (default) and never touches RabbitMQ", async () => {
    const { db, values } = makeDb();
    const rabbit = { publishForAudit: jest.fn() } as unknown as RabbitMQAuditTransport;
    const listener = new AuditListener(db, new RequestContextService(), new EventEmitter2(), makeConfig("in-process"), rabbit);

    await listener.handleDomainEvent(sampleEvent);

    expect(values).toHaveBeenCalledTimes(1);
    expect(rabbit.publishForAudit).not.toHaveBeenCalled();
  });

  it("skips the direct write when RabbitMQ confirms the publish", async () => {
    const { db, values } = makeDb();
    const rabbit = { publishForAudit: jest.fn().mockResolvedValue(true) } as unknown as RabbitMQAuditTransport;
    const listener = new AuditListener(db, new RequestContextService(), new EventEmitter2(), makeConfig("rabbitmq"), rabbit);

    await listener.handleDomainEvent(sampleEvent);

    expect(rabbit.publishForAudit).toHaveBeenCalledWith(sampleEvent);
    expect(values).not.toHaveBeenCalled();
  });

  it("falls back to the direct write when RabbitMQ does not confirm the publish", async () => {
    const { db, values } = makeDb();
    const rabbit = { publishForAudit: jest.fn().mockResolvedValue(false) } as unknown as RabbitMQAuditTransport;
    const listener = new AuditListener(db, new RequestContextService(), new EventEmitter2(), makeConfig("rabbitmq"), rabbit);

    await listener.handleDomainEvent(sampleEvent);

    expect(rabbit.publishForAudit).toHaveBeenCalledWith(sampleEvent);
    expect(values).toHaveBeenCalledTimes(1);
  });

  it("starts consuming from RabbitMQ on module init only when the transport is rabbitmq", async () => {
    const { db } = makeDb();
    const rabbitOn = { startConsuming: jest.fn().mockResolvedValue(undefined) } as unknown as RabbitMQAuditTransport;
    const listenerOn = new AuditListener(db, new RequestContextService(), new EventEmitter2(), makeConfig("rabbitmq"), rabbitOn);
    await listenerOn.onModuleInit();
    expect(rabbitOn.startConsuming).toHaveBeenCalledWith(expect.any(Function));

    const rabbitOff = { startConsuming: jest.fn() } as unknown as RabbitMQAuditTransport;
    const listenerOff = new AuditListener(db, new RequestContextService(), new EventEmitter2(), makeConfig("in-process"), rabbitOff);
    await listenerOff.onModuleInit();
    expect(rabbitOff.startConsuming).not.toHaveBeenCalled();
  });
});
