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

describe("Products & Pricing (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates, lists, updates, and soft-deletes a product", async () => {
    const org = await registerOrg(app, "Initrode Products", "ip");

    const created = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Widget Pro", sku: "WID-001", unitPrice: 49.99, taxPercent: 8.5 })
      .expect(201);
    expect(created.body.name).toBe("Widget Pro");
    expect(created.body.unitPrice).toBe(49.99);
    expect(created.body.currency).toBe("USD");
    expect(created.body.isActive).toBe(true);

    const list = await request(app.getHttpServer())
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(list.body.map((p: { id: string }) => p.id)).toContain(created.body.id);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/products/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ unitPrice: 59.99 })
      .expect(200);
    expect(updated.body.unitPrice).toBe(59.99);

    await request(app.getHttpServer())
      .delete(`/api/v1/products/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/products/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(404);
  });

  it("404s when an org tries to read another org's product", async () => {
    const orgA = await registerOrg(app, "Massive Dynamic", "md");
    const orgB = await registerOrg(app, "Umbrella Corp", "uc");

    const product = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ name: "Org A widget", unitPrice: 10 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/products/${product.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);
  });

  it("manages price tiers and returns the best-matching tier price for a quantity", async () => {
    const org = await registerOrg(app, "Soylent Products", "sp");

    const product = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ name: "Bulk Widget", unitPrice: 100 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/products/${product.body.id}/price-tiers`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ minQuantity: 10, unitPrice: 90 })
      .expect(201);
    const tier50 = await request(app.getHttpServer())
      .post(`/api/v1/products/${product.body.id}/price-tiers`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ minQuantity: 50, unitPrice: 75 })
      .expect(201);

    const tiers = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.body.id}/price-tiers`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(tiers.body).toHaveLength(2);
    expect(tiers.body.map((t: { minQuantity: number }) => t.minQuantity)).toEqual([10, 50]);

    const priceAt5 = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.body.id}/price?quantity=5`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(priceAt5.body.unitPrice).toBe(100); // below any tier — base price
    const priceAt10 = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.body.id}/price?quantity=10`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(priceAt10.body.unitPrice).toBe(90);
    const priceAt50 = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.body.id}/price?quantity=50`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(priceAt50.body.unitPrice).toBe(75);

    await request(app.getHttpServer())
      .patch(`/api/v1/products/${product.body.id}/price-tiers/${tier50.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ unitPrice: 70 })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/products/${product.body.id}/price-tiers/${tier50.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    const remaining = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.body.id}/price-tiers`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(remaining.body).toHaveLength(1);
  });

  it("enforces RBAC: a Member can create/edit products but cannot delete them or manage pricing", async () => {
    const org = await registerOrg(app, "Stark Industries Products", "sip");

    const roles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-products"), fullName: "Pepper Member", roleIds: [memberRole.id] })
      .expect(201);

    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);
    const memberToken = memberLogin.body.tokens.accessToken as string;

    const product = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "Member-created widget", unitPrice: 20 })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/products/${product.body.id}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ unitPrice: 25 })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/products/${product.body.id}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/products/${product.body.id}/price-tiers`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ minQuantity: 10, unitPrice: 15 })
      .expect(403);
  });
});
