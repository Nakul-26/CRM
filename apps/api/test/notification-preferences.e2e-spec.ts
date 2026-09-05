import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./setup/test-app";
import { NotificationDigestService } from "../src/modules/notifications/notification-digest.service";
import { assertNoMessage, clearMailpit, getMessage, waitForMessage } from "./setup/mailpit";

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function registerOrg(app: INestApplication, orgName: string, ownerLabel: string) {
  const email = uniqueEmail(ownerLabel);
  const res = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send({ organizationName: orgName, fullName: `${ownerLabel} Owner`, email, password: "SuperSecret123" })
    .expect(201);
  return { email, accessToken: res.body.tokens.accessToken as string, user: res.body.user };
}

/** Invites a second user in the same org with the Owner role, so they need no extra permission grants. */
async function inviteSecondUser(app: INestApplication, ownerToken: string, label: string) {
  const roles = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", `Bearer ${ownerToken}`).expect(200);
  const ownerRole = roles.body.find((r: { name: string }) => r.name === "Owner");
  const email = uniqueEmail(label);

  const invited = await request(app.getHttpServer())
    .post("/api/v1/users/invite")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ email, fullName: `${label} User`, roleIds: [ownerRole.id] })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
    .expect(200);
  return { id: invited.body.user.id as string, email, accessToken: login.body.tokens.accessToken as string };
}

async function createAccount(app: INestApplication, token: string, name: string) {
  const res = await request(app.getHttpServer()).post("/api/v1/accounts").set("Authorization", `Bearer ${token}`).send({ name }).expect(201);
  return res.body as { id: string; name: string };
}

async function assignNewTicket(app: INestApplication, ownerToken: string, accountId: string, assigneeId: string) {
  const ticket = await request(app.getHttpServer())
    .post("/api/v1/tickets")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ subject: "Help needed", accountId })
    .expect(201);
  await request(app.getHttpServer())
    .post(`/api/v1/tickets/${ticket.body.id}/assign`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ assigneeId })
    .expect(201);
  return ticket.body as { id: string };
}

function setPreferences(app: INestApplication, token: string, emailDelivery: string) {
  return request(app.getHttpServer()).put("/api/v1/notifications/preferences").set("Authorization", `Bearer ${token}`).send({ emailDelivery });
}

describe("Notification preferences + email digest (e2e, real Mailpit)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("defaults to \"off\", can be updated, and rejects an invalid mode", async () => {
    const org = await registerOrg(app, "Notif Prefs Co", "npc");

    const initial = await request(app.getHttpServer())
      .get("/api/v1/notifications/preferences")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(initial.body).toEqual({ emailDelivery: "off" });

    await setPreferences(app, org.accessToken, "immediate").expect(200);
    const updated = await request(app.getHttpServer())
      .get("/api/v1/notifications/preferences")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(updated.body).toEqual({ emailDelivery: "immediate" });

    await setPreferences(app, org.accessToken, "not-a-real-mode").expect(400);
  });

  it("requires authentication", async () => {
    await request(app.getHttpServer()).get("/api/v1/notifications/preferences").expect(401);
    await request(app.getHttpServer()).put("/api/v1/notifications/preferences").send({ emailDelivery: "off" }).expect(401);
  });

  it("emails immediately, in addition to the in-app notification, when set to \"immediate\"", async () => {
    await clearMailpit();
    const org = await registerOrg(app, "Notif Immediate Co", "nic");
    const second = await inviteSecondUser(app, org.accessToken, "nic-second");
    const account = await createAccount(app, org.accessToken, "Notif Immediate Account");
    await setPreferences(app, second.accessToken, "immediate").expect(200);

    const ticket = await assignNewTicket(app, org.accessToken, account.id, second.id);

    // ticket.assigned is consumed by a fire-and-forget EventEmitter2 listener
    // (DomainEventBus.publish uses plain .emit(), not .emitAsync()), so
    // notification creation is eventually consistent with the assign
    // response, not synchronous with it. NotificationsService.create()
    // always inserts the in-app row before it ever attempts the immediate
    // email, so waiting for the email (a real SMTP round trip, the slower of
    // the two) first guarantees the in-app row is already committed by the
    // time we check for it below — no arbitrary poll/sleep needed.
    const message = await waitForMessage((m) => m.To.some((addr) => addr.Address === second.email));
    expect(message.Subject).toBe("A ticket was assigned to you");
    const full = await getMessage(message.ID);
    expect(full.Text).toContain(`/support/tickets/${ticket.id}`);

    const list = await request(app.getHttpServer()).get("/api/v1/notifications").set("Authorization", `Bearer ${second.accessToken}`).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it("does not email immediately, but a digest run emails a summary and is idempotent, when set to \"daily_digest\"", async () => {
    await clearMailpit();
    const org = await registerOrg(app, "Notif Digest Co", "ndc");
    const second = await inviteSecondUser(app, org.accessToken, "ndc-second");
    const account = await createAccount(app, org.accessToken, "Notif Digest Account");
    await setPreferences(app, second.accessToken, "daily_digest").expect(200);

    const ticket = await assignNewTicket(app, org.accessToken, account.id, second.id);
    await assertNoMessage((m) => m.To.some((addr) => addr.Address === second.email));

    const digest = app.get(NotificationDigestService);
    const sent = await digest.sendDueDigests();
    expect(sent).toBeGreaterThanOrEqual(1);

    const message = await waitForMessage((m) => m.To.some((addr) => addr.Address === second.email));
    expect(message.Subject).toBe("Your daily notification digest");
    const full = await getMessage(message.ID);
    expect(full.Text).toContain(`/support/tickets/${ticket.id}`);

    // Idempotency: the notification above is now digestSentAt-stamped, so a
    // second run must not re-email it.
    await clearMailpit();
    await digest.sendDueDigests();
    await assertNoMessage((m) => m.To.some((addr) => addr.Address === second.email));
  });
});
