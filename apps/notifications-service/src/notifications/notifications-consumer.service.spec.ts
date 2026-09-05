import type { DomainEvent } from "@sales-platform/contracts";
import { NotificationsConsumerService } from "./notifications-consumer.service";
import type { DomainEventsConsumer } from "../rabbitmq/domain-events-consumer";
import type { NotificationsService } from "./notifications.service";

function makeConsumer() {
  return { startConsuming: jest.fn() } as unknown as jest.Mocked<DomainEventsConsumer>;
}

function makeNotifications() {
  return { create: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<NotificationsService>;
}

function baseEvent(overrides: Partial<DomainEvent>): DomainEvent {
  return {
    eventId: "11111111-1111-1111-1111-111111111111",
    eventType: "ticket.assigned",
    timestamp: "2026-08-22T00:00:00.000Z",
    organizationId: "22222222-2222-2222-2222-222222222222",
    correlationId: "33333333-3333-3333-3333-333333333333",
    payload: {},
    ...overrides,
  };
}

// handleEvent is private — same casting idiom used throughout this codebase
// (e.g. RabbitMQAuditTransport's own spec) to exercise it directly.
function asHandleEvent(service: NotificationsConsumerService) {
  const withPrivate = service as unknown as { handleEvent: (event: DomainEvent) => Promise<void> };
  return withPrivate.handleEvent.bind(withPrivate);
}

describe("NotificationsConsumerService", () => {
  it("binds startConsuming to the 7 documented routing keys on module init", async () => {
    const consumer = makeConsumer();
    const service = new NotificationsConsumerService(consumer, makeNotifications());

    await service.onModuleInit();

    expect(consumer.startConsuming).toHaveBeenCalledWith(
      ["ticket.assigned", "opportunity.won", "opportunity.lost", "quote.accepted", "quote.rejected", "payment.succeeded", "payment.failed"],
      expect.any(Function),
    );
  });

  it("creates a notification for the assignee on ticket.assigned", async () => {
    const notifications = makeNotifications();
    const service = new NotificationsConsumerService(makeConsumer(), notifications);
    const event = baseEvent({ eventType: "ticket.assigned", payload: { ticketId: "tk_1", assigneeId: "user_1" } });

    await asHandleEvent(service)(event);

    expect(notifications.create).toHaveBeenCalledWith(event.organizationId, "user_1", {
      type: "ticket.assigned",
      title: "A ticket was assigned to you",
      link: "/support/tickets/tk_1",
    });
  });

  it("creates a notification for the owner on opportunity.won", async () => {
    const notifications = makeNotifications();
    const service = new NotificationsConsumerService(makeConsumer(), notifications);
    const event = baseEvent({ eventType: "opportunity.won", payload: { opportunityId: "opp_1", ownerId: "user_2", value: 100 } });

    await asHandleEvent(service)(event);

    expect(notifications.create).toHaveBeenCalledWith(event.organizationId, "user_2", {
      type: "opportunity.won",
      title: "Your opportunity was won",
      link: "/sales/opportunities/opp_1",
    });
  });

  it("skips creating a notification when the recipient is null", async () => {
    const notifications = makeNotifications();
    const service = new NotificationsConsumerService(makeConsumer(), notifications);
    const event = baseEvent({ eventType: "opportunity.lost", payload: { opportunityId: "opp_1", ownerId: null, value: null } });

    await asHandleEvent(service)(event);

    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("skips creating a notification when the recipient is the actor who triggered the event", async () => {
    const notifications = makeNotifications();
    const service = new NotificationsConsumerService(makeConsumer(), notifications);
    const event = baseEvent({
      eventType: "quote.accepted",
      actorId: "user_3",
      payload: { quoteId: "q_1", ownerId: "user_3" },
    });

    await asHandleEvent(service)(event);

    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("logs and does not throw when notification creation fails", async () => {
    const notifications = makeNotifications();
    notifications.create.mockRejectedValueOnce(new Error("db down"));
    const service = new NotificationsConsumerService(makeConsumer(), notifications);
    const event = baseEvent({ eventType: "payment.failed", payload: { paymentId: "p_1", subscriptionId: "s_1", recipientId: "user_4" } });

    await expect(asHandleEvent(service)(event)).resolves.toBeUndefined();
  });

  it("does not throw on an unrecognized event type (defensive — the queue is bound to only 7 keys)", async () => {
    const service = new NotificationsConsumerService(makeConsumer(), makeNotifications());
    const event = baseEvent({ eventType: "account.created", payload: {} });

    await expect(asHandleEvent(service)(event)).resolves.toBeUndefined();
  });
});
