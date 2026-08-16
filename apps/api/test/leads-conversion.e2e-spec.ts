import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./setup/test-app";

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

async function createQualifiedLead(app: INestApplication, token: string, body: Record<string, unknown>) {
  const created = await request(app.getHttpServer())
    .post("/api/v1/leads")
    .set("Authorization", `Bearer ${token}`)
    .send(body)
    .expect(201);
  await request(app.getHttpServer())
    .post(`/api/v1/leads/${created.body.id}/qualify`)
    .set("Authorization", `Bearer ${token}`)
    .send({ outcome: "qualified" })
    .expect(201);
  return created.body;
}

describe("Lead conversion (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects conversion unless the lead is Qualified", async () => {
    const org = await registerOrg(app, "Guard Corp", "gc");
    const lead = await request(app.getHttpServer())
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Not Ready", source: "website" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/leads/${lead.body.id}/convert`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(400);
  });

  it("converts a Qualified lead into a new Account + Contact, and the lead becomes immutable", async () => {
    const org = await registerOrg(app, "Fresh Start Inc", "fs");
    const lead = await createQualifiedLead(app, org.accessToken, {
      name: "Dwight Schrute",
      company: "Fresh Start Inc Prospect",
      email: uniqueEmail("dwight"),
      source: "cold_outreach",
    });

    const converted = await request(app.getHttpServer())
      .post(`/api/v1/leads/${lead.id}/convert`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);
    expect(converted.body.lead.status).toBe("Converted");
    expect(converted.body.reusedExistingAccount).toBe(false);
    expect(converted.body.reusedExistingContact).toBe(false);
    expect(converted.body.account.name).toBe("Fresh Start Inc Prospect");
    expect(converted.body.contact.firstName).toBe("Dwight");
    expect(converted.body.contact.lastName).toBe("Schrute");
    expect(converted.body.opportunity).toBeDefined();
    expect(converted.body.opportunity.name).toBe("Fresh Start Inc Prospect - New Business");

    const accountCheck = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${converted.body.account.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(accountCheck.body.id).toBe(converted.body.account.id);

    const opportunityCheck = await request(app.getHttpServer())
      .get(`/api/v1/opportunities/${converted.body.opportunity.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(opportunityCheck.body.accountId).toBe(converted.body.account.id);
    expect(opportunityCheck.body.contactId).toBe(converted.body.contact.id);
    expect(opportunityCheck.body.stageId).toBe(converted.body.opportunity.stageId);
    expect(opportunityCheck.body.outcome).toBe("open");

    // Converted is terminal: no further status transitions.
    await request(app.getHttpServer())
      .post(`/api/v1/leads/${lead.id}/qualify`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ outcome: "unqualified" })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/leads/${lead.id}/convert`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(400);
  });

  it("reuses an existing Account/Contact instead of creating duplicates during conversion", async () => {
    const org = await registerOrg(app, "Reuse Co", "rc");

    const existingAccount = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Wernham Hogg" })
      .expect(201);
    const sharedEmail = uniqueEmail("david");
    const existingContact = await request(app.getHttpServer())
      .post("/api/v1/contacts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ firstName: "David", lastName: "Brent", email: sharedEmail })
      .expect(201);

    const lead = await createQualifiedLead(app, org.accessToken, {
      name: "David Brent",
      company: "wernham hogg", // case-insensitive match against "Wernham Hogg"
      email: sharedEmail.toUpperCase(), // case-insensitive match too
      source: "referral",
    });

    const converted = await request(app.getHttpServer())
      .post(`/api/v1/leads/${lead.id}/convert`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);
    expect(converted.body.reusedExistingAccount).toBe(true);
    expect(converted.body.reusedExistingContact).toBe(true);
    expect(converted.body.account.id).toBe(existingAccount.body.id);
    expect(converted.body.contact.id).toBe(existingContact.body.id);

    // No second account/contact was created.
    const accounts = await request(app.getHttpServer())
      .get("/api/v1/accounts")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(accounts.body.filter((a: { name: string }) => a.name.toLowerCase() === "wernham hogg")).toHaveLength(1);
  });

  it("shows the conversion on the resulting account's timeline (proves the TIMELINE_EVENT_TYPES extension)", async () => {
    const org = await registerOrg(app, "Timeline Co", "tl");
    const lead = await createQualifiedLead(app, org.accessToken, {
      name: "Angela Martin",
      company: "Timeline Prospect LLC",
      source: "event",
    });

    const converted = await request(app.getHttpServer())
      .post(`/api/v1/leads/${lead.id}/convert`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);

    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${converted.body.account.id}/timeline`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const conversionEntry = timeline.body.find((e: { type: string }) => e.type === "lead.converted");
    expect(conversionEntry).toBeDefined();
    expect(conversionEntry.payload.leadId).toBe(lead.id);

    // The Opportunity created alongside conversion also shows up, via the
    // same TIMELINE_EVENT_TYPES extension point — no new code needed here.
    const opportunityEntry = timeline.body.find((e: { type: string }) => e.type === "opportunity.created");
    expect(opportunityEntry).toBeDefined();
    expect(opportunityEntry.payload.opportunityId).toBe(converted.body.opportunity.id);
  });

  it("enforces RBAC: a Member can convert (has leads.convert) but qualification still gates it", async () => {
    const org = await registerOrg(app, "Convert RBAC Co", "cr");

    const roles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");
    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-convert"), fullName: "Mel Member", roleIds: [memberRole.id] })
      .expect(201);
    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);
    const memberToken = memberLogin.body.tokens.accessToken as string;

    const lead = await createQualifiedLead(app, memberToken, { name: "Kelly Kapoor", source: "linkedin" });

    const converted = await request(app.getHttpServer())
      .post(`/api/v1/leads/${lead.id}/convert`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(201);
    expect(converted.body.lead.status).toBe("Converted");
  });
});
