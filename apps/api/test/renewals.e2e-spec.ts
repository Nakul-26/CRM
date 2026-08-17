import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createTestApp } from "./setup/test-app";
import { assertNoMessage, clearMailpit, waitForMessage } from "./setup/mailpit";
import { DATABASE_CONNECTION, type Database } from "../src/database/database.module";
import { renewalReminders } from "../src/database/schema";
import { RenewalsService } from "../src/modules/subscriptions/renewals/renewals.service";

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

async function createAccount(app: INestApplication, token: string, name: string) {
  const res = await request(app.getHttpServer()).post("/api/v1/accounts").set("Authorization", `Bearer ${token}`).send({ name }).expect(201);
  return res.body.id as string;
}

async function createContact(app: INestApplication, token: string, accountId: string, email: string) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/contacts")
    .set("Authorization", `Bearer ${token}`)
    .send({ accountId, firstName: "Jane", lastName: "Customer", email })
    .expect(201);
  return res.body.id as string;
}

async function createPlan(app: INestApplication, token: string) {
  const res = await request(app.getHttpServer())
    .post("/api/v1/plans")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `Plan-${Date.now()}-${Math.random().toString(36).slice(2)}`, price: 25, billingInterval: "monthly" })
    .expect(201);
  return res.body.id as string;
}

async function backdateReminder(app: INestApplication, subscriptionId: string) {
  const db = app.get<Database>(DATABASE_CONNECTION);
  const past = new Date(Date.now() - 60_000);
  await db.update(renewalReminders).set({ remindAt: past }).where(eq(renewalReminders.subscriptionId, subscriptionId));
}

describe("Renewal reminders (e2e, real Mailpit)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("dispatches a due reminder to the subscription's contact and marks it sent", async () => {
    await clearMailpit();
    const org = await registerOrg(app, "Initrode Renewals", "ir");
    const accountId = await createAccount(app, org.accessToken, "Initrode Account");
    const contactEmail = uniqueEmail("renewal-contact");
    const contactId = await createContact(app, org.accessToken, accountId, contactEmail);
    const planId = await createPlan(app, org.accessToken);

    const created = await request(app.getHttpServer())
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId, planId, contactId })
      .expect(201);
    expect(created.body.currentPeriodReminderSent).toBe(false);

    await backdateReminder(app, created.body.id);

    const renewals = app.get(RenewalsService);
    const processed = await renewals.processDueReminders();
    expect(processed).toBeGreaterThanOrEqual(1);

    const message = await waitForMessage((m) => m.To.some((addr) => addr.Address === contactEmail));
    expect(message.Subject).toContain("renews soon");

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/subscriptions/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(fetched.body.currentPeriodReminderSent).toBe(true);
  });

  it("marks a due reminder sent without attempting an email when the subscription has no contact", async () => {
    await clearMailpit();
    const org = await registerOrg(app, "Massive Dynamic Renewals", "mdr");
    const accountId = await createAccount(app, org.accessToken, "Massive Dynamic Account");
    const planId = await createPlan(app, org.accessToken);

    const created = await request(app.getHttpServer())
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId, planId })
      .expect(201);
    expect(created.body.contactId).toBeNull();

    await backdateReminder(app, created.body.id);

    const renewals = app.get(RenewalsService);
    await renewals.processDueReminders();

    await assertNoMessage(() => true);

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/subscriptions/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(fetched.body.currentPeriodReminderSent).toBe(true);
  });

  it("never fires a reminder for a subscription that was cancelled before the scheduler ran", async () => {
    await clearMailpit();
    const org = await registerOrg(app, "Umbrella Corp Renewals", "ucr");
    const accountId = await createAccount(app, org.accessToken, "Umbrella Account");
    const contactEmail = uniqueEmail("cancelled-contact");
    const contactId = await createContact(app, org.accessToken, accountId, contactEmail);
    const planId = await createPlan(app, org.accessToken);

    const created = await request(app.getHttpServer())
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ accountId, planId, contactId })
      .expect(201);

    await backdateReminder(app, created.body.id);

    await request(app.getHttpServer())
      .post(`/api/v1/subscriptions/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);

    const renewals = app.get(RenewalsService);
    const processed = await renewals.processDueReminders();
    expect(processed).toBe(0);

    await assertNoMessage((m) => m.To.some((addr) => addr.Address === contactEmail));
  });
});
