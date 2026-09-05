import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import amqp, { type ChannelModel } from "amqplib";
import request from "supertest";
import type { DomainEvent } from "@sales-platform/contracts";
import { createTestApp } from "./setup/test-app";

const EXCHANGE = "domain.events";

function signAccessToken(claims: { sub: string; organizationId: string; email?: string; fullName?: string; permissions?: string[] }): string {
  const jwt = new JwtService();
  return jwt.sign(
    {
      sub: claims.sub,
      organizationId: claims.organizationId,
      email: claims.email ?? "test@example.com",
      fullName: claims.fullName ?? "Test User",
      permissions: claims.permissions ?? [],
    },
    { secret: process.env.JWT_ACCESS_SECRET, expiresIn: "15m" },
  );
}

function makeDomainEvent<T>(eventType: string, organizationId: string, payload: T, actorId?: string): DomainEvent<string, T> {
  return {
    eventId: randomUUID(),
    eventType,
    timestamp: new Date().toISOString(),
    organizationId,
    actorId,
    correlationId: randomUUID(),
    payload,
  };
}

/**
 * Publishes directly onto the same `domain.events` topic exchange
 * apps/api's RabbitMQAuditTransport publishes every domain event onto under
 * EVENT_BUS_TRANSPORT=rabbitmq — a real broker round trip, proving this
 * service's own consumer genuinely works, without needing to also boot the
 * full apps/api monolith just to trigger one. See
 * docs/decisions/0018-microservices-split-phase18-scope.md.
 */
async function publishDomainEvent(connection: ChannelModel, event: DomainEvent): Promise<void> {
  const channel = await connection.createConfirmChannel();
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  await new Promise<void>((resolve, reject) => {
    channel.publish(EXCHANGE, event.eventType, Buffer.from(JSON.stringify(event)), { persistent: true, contentType: "application/json" }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
  await channel.close();
}

async function waitForNotification(
  app: INestApplication,
  token: string,
  predicate: (n: { id: string; type: string; link: string | null }) => boolean,
  timeoutMs = 10000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app.getHttpServer()).get("/api/v1/notifications").set("Authorization", `Bearer ${token}`).expect(200);
    const match = (res.body as { id: string; type: string; link: string | null }[]).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for a matching notification`);
}

describe("Notifications service (e2e)", () => {
  let app: INestApplication;
  let connection: ChannelModel;

  beforeAll(async () => {
    app = await createTestApp();
    connection = await amqp.connect(process.env.RABBITMQ_URL as string);
  });

  afterAll(async () => {
    await connection.close();
    await app.close();
  });

  it("consumes a real domain event off RabbitMQ and makes it readable via the API for the right recipient", async () => {
    const organizationId = randomUUID();
    const assigneeId = randomUUID();
    const ticketId = randomUUID();
    const token = signAccessToken({ sub: assigneeId, organizationId });

    const event = makeDomainEvent("ticket.assigned", organizationId, { ticketId, assigneeId }, randomUUID());
    await publishDomainEvent(connection, event);

    const notification = await waitForNotification(app, token, (n) => n.link === `/support/tickets/${ticketId}`);
    expect(notification.type).toBe("ticket.assigned");
  });

  it("does not create a notification when the recipient is the actor who triggered the event", async () => {
    const organizationId = randomUUID();
    const ownerId = randomUUID();
    const opportunityId = randomUUID();
    const token = signAccessToken({ sub: ownerId, organizationId });

    // actorId === ownerId (the payload's recipient) — must be skipped.
    const event = makeDomainEvent("opportunity.won", organizationId, { opportunityId, ownerId, value: 100 }, ownerId);
    await publishDomainEvent(connection, event);

    // Prove absence by publishing a second, distinguishable event for the
    // same recipient and waiting for *that* one — if the skipped event had
    // wrongly created a notification, it would already be in the list here.
    const secondOpportunityId = randomUUID();
    const secondEvent = makeDomainEvent("opportunity.won", organizationId, { opportunityId: secondOpportunityId, ownerId, value: 200 }, randomUUID());
    await publishDomainEvent(connection, secondEvent);
    await waitForNotification(app, token, (n) => n.link === `/sales/opportunities/${secondOpportunityId}`);

    const res = await request(app.getHttpServer()).get("/api/v1/notifications").set("Authorization", `Bearer ${token}`).expect(200);
    const wronglyCreated = (res.body as { link: string | null }[]).find((n) => n.link === `/sales/opportunities/${opportunityId}`);
    expect(wronglyCreated).toBeUndefined();
  });

  it("rejects requests with no bearer token", async () => {
    await request(app.getHttpServer()).get("/api/v1/notifications").expect(401);
  });

  it("rejects requests with an invalid bearer token", async () => {
    await request(app.getHttpServer()).get("/api/v1/notifications").set("Authorization", "Bearer not-a-real-token").expect(401);
  });

  it("marks a notification read and it disappears from the unread-only view", async () => {
    const organizationId = randomUUID();
    const assigneeId = randomUUID();
    const ticketId = randomUUID();
    const token = signAccessToken({ sub: assigneeId, organizationId });

    const event = makeDomainEvent("ticket.assigned", organizationId, { ticketId, assigneeId }, randomUUID());
    await publishDomainEvent(connection, event);
    const notification = await waitForNotification(app, token, (n) => n.link === `/support/tickets/${ticketId}`);

    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const unread = await request(app.getHttpServer()).get("/api/v1/notifications?unreadOnly=true").set("Authorization", `Bearer ${token}`).expect(200);
    expect((unread.body as { id: string }[]).some((n) => n.id === notification.id)).toBe(false);
  });
});
