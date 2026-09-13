import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@sales-platform/config";
import type { DomainEvent } from "@sales-platform/contracts";
import { NotificationsListener } from "./notifications.listener";
import { NotificationsService } from "./notifications.service";
import { RabbitMQDomainEventConsumer } from "../../shared/events/rabbitmq-domain-event-consumer";

jest.mock("../../shared/events/rabbitmq-domain-event-consumer");

function makeConfig(transport: "in-process" | "rabbitmq") {
  return { get: () => transport } as unknown as ConfigService<ApiEnv, true>;
}

function makeNotifications() {
  return { create: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
}

const ticketAssignedEvent: DomainEvent<"ticket.assigned", { ticketId: string; assigneeId: string | null }> = {
  eventId: "11111111-1111-1111-1111-111111111111",
  eventType: "ticket.assigned",
  timestamp: "2026-08-22T00:00:00.000Z",
  organizationId: "22222222-2222-2222-2222-222222222222",
  actorId: "actor_1",
  correlationId: "33333333-3333-3333-3333-333333333333",
  payload: { ticketId: "tk_1", assigneeId: "user_1" },
};

describe("NotificationsListener", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a notification directly when the transport is in-process (default)", async () => {
    const notifications = makeNotifications();
    const listener = new NotificationsListener(notifications, makeConfig("in-process"));

    await listener.onTicketAssigned(ticketAssignedEvent);

    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it("skips creating a notification directly when the transport is rabbitmq, deferring to its own consumer", async () => {
    const notifications = makeNotifications();
    const listener = new NotificationsListener(notifications, makeConfig("rabbitmq"));

    await listener.onTicketAssigned(ticketAssignedEvent);

    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("starts consuming from RabbitMQ on module init only when the transport is rabbitmq, with the 7 curated routing keys", async () => {
    const startConsuming = jest.fn().mockResolvedValue(undefined);
    (RabbitMQDomainEventConsumer as jest.Mock).mockImplementation(() => ({ startConsuming }));

    const listenerOn = new NotificationsListener(makeNotifications(), makeConfig("rabbitmq"));
    await listenerOn.onModuleInit();
    expect(RabbitMQDomainEventConsumer).toHaveBeenCalledWith(expect.anything(), "notifications.monolith.consumer");
    expect(startConsuming).toHaveBeenCalledWith(
      ["ticket.assigned", "opportunity.won", "opportunity.lost", "quote.accepted", "quote.rejected", "payment.succeeded", "payment.failed"],
      expect.any(Function),
    );

    jest.clearAllMocks();
    (RabbitMQDomainEventConsumer as jest.Mock).mockImplementation(() => ({ startConsuming }));
    const listenerOff = new NotificationsListener(makeNotifications(), makeConfig("in-process"));
    await listenerOff.onModuleInit();
    expect(RabbitMQDomainEventConsumer).not.toHaveBeenCalled();
  });

  it("the queue consumer callback dispatches a ticket.assigned message to the same notify logic", async () => {
    let capturedOnMessage: ((event: DomainEvent) => Promise<void>) | undefined;
    (RabbitMQDomainEventConsumer as jest.Mock).mockImplementation(() => ({
      startConsuming: jest.fn().mockImplementation(async (_routingKeys: string[], onMessage: (event: DomainEvent) => Promise<void>) => {
        capturedOnMessage = onMessage;
      }),
    }));
    const notifications = makeNotifications();
    const listener = new NotificationsListener(notifications, makeConfig("rabbitmq"));
    await listener.onModuleInit();

    await capturedOnMessage?.(ticketAssignedEvent);

    expect(notifications.create).toHaveBeenCalledWith(
      ticketAssignedEvent.organizationId,
      "user_1",
      expect.objectContaining({ type: "ticket.assigned" }),
    );
  });
});
