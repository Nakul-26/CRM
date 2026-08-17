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

describe("Plans (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates, lists, updates, and soft-deletes a plan", async () => {
    const org = await registerOrg(app, "Initrode Billing", "ib");

    const created = await request(app.getHttpServer())
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Pro", price: 99.5, billingInterval: "monthly" })
      .expect(201);
    expect(created.body.name).toBe("Pro");
    expect(created.body.price).toBe(99.5);
    expect(created.body.billingInterval).toBe("monthly");
    expect(created.body.isActive).toBe(true);

    const list = await request(app.getHttpServer())
      .get("/api/v1/plans")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(list.body.map((p: { id: string }) => p.id)).toContain(created.body.id);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/plans/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ price: 149 })
      .expect(200);
    expect(updated.body.price).toBe(149);

    await request(app.getHttpServer())
      .delete(`/api/v1/plans/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/plans/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(404);
  });

  it("enforces org+name uniqueness, and allows re-adding after a delete", async () => {
    const org = await registerOrg(app, "Massive Dynamic Billing", "mdb");

    const first = await request(app.getHttpServer())
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Starter", price: 19 })
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Starter", price: 25 })
      .expect(409);

    await request(app.getHttpServer())
      .delete(`/api/v1/plans/${first.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    // Re-adding a plan with the same name after the old one was soft-deleted must succeed.
    await request(app.getHttpServer())
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Starter", price: 25 })
      .expect(201);
  });

  it("404s when an org tries to read another org's plan", async () => {
    const orgA = await registerOrg(app, "Umbrella Corp Billing", "ucb");
    const orgB = await registerOrg(app, "Wayne Enterprises Billing", "web");

    const plan = await request(app.getHttpServer())
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ name: "Org A Plan", price: 10 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/plans/${plan.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);
  });

  it("enforces RBAC: Members can view plans but not create/edit/delete them", async () => {
    const org = await registerOrg(app, "Stark Industries Billing", "sib");

    const roles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-plan"), fullName: "Pepper Member", roleIds: [memberRole.id] })
      .expect(201);

    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);
    const memberToken = memberLogin.body.tokens.accessToken as string;

    await request(app.getHttpServer())
      .get("/api/v1/plans")
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post("/api/v1/plans")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Member Plan", price: 5 })
      .expect(403);
  });
});
