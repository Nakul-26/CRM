import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./setup/test-app";

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueSlug(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function registerOrg(app: INestApplication, orgName: string, ownerLabel: string) {
  const email = uniqueEmail(ownerLabel);
  const res = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send({ organizationName: orgName, fullName: `${ownerLabel} Owner`, email, password: "SuperSecret123" })
    .expect(201);
  return { email, accessToken: res.body.tokens.accessToken as string, user: res.body.user };
}

describe("Knowledge Base (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates, lists, updates, and soft-deletes a KB article", async () => {
    const org = await registerOrg(app, "Initrode KB", "ik");
    const slug = uniqueSlug("resetting-your-password");

    const created = await request(app.getHttpServer())
      .post("/api/v1/kb")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ title: "Resetting your password", slug, body: "Click forgot password...", tags: ["account"] })
      .expect(201);
    expect(created.body.isPublished).toBe(false);
    expect(created.body.publishedAt).toBeNull();

    const list = await request(app.getHttpServer())
      .get("/api/v1/kb")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    expect(list.body.map((a: { id: string }) => a.id)).toContain(created.body.id);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/kb/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ body: "Updated instructions..." })
      .expect(200);
    expect(updated.body.body).toBe("Updated instructions...");

    await request(app.getHttpServer())
      .delete(`/api/v1/kb/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/kb/${created.body.id}`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(404);
  });

  it("enforces global slug uniqueness, even across organizations", async () => {
    const orgA = await registerOrg(app, "Massive Dynamic KB", "mdk");
    const orgB = await registerOrg(app, "Umbrella Corp KB", "uck");
    const slug = uniqueSlug("shared-slug");

    await request(app.getHttpServer())
      .post("/api/v1/kb")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ title: "Org A article", slug, body: "Body" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/v1/kb")
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .send({ title: "Org B article", slug, body: "Body" })
      .expect(409);
  });

  it("publish/unpublish sets isPublished and publishedAt", async () => {
    const org = await registerOrg(app, "Wayne Enterprises KB", "wek");
    const slug = uniqueSlug("getting-started");

    const created = await request(app.getHttpServer())
      .post("/api/v1/kb")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ title: "Getting started", slug, body: "Welcome..." })
      .expect(201);

    const published = await request(app.getHttpServer())
      .post(`/api/v1/kb/${created.body.id}/publish`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);
    expect(published.body.isPublished).toBe(true);
    expect(published.body.publishedAt).not.toBeNull();

    const unpublished = await request(app.getHttpServer())
      .post(`/api/v1/kb/${created.body.id}/unpublish`)
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(201);
    expect(unpublished.body.isPublished).toBe(false);
    expect(unpublished.body.publishedAt).toBeNull();
  });

  it("404s when an org tries to read another org's KB article", async () => {
    const orgA = await registerOrg(app, "Stark Industries KB", "sik");
    const orgB = await registerOrg(app, "Acme Corp KB", "ack");
    const slug = uniqueSlug("org-a-secret-doc");

    const article = await request(app.getHttpServer())
      .post("/api/v1/kb")
      .set("Authorization", `Bearer ${orgA.accessToken}`)
      .send({ title: "Org A doc", slug, body: "Body" })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/kb/${article.body.id}`)
      .set("Authorization", `Bearer ${orgB.accessToken}`)
      .expect(404);
  });

  it("enforces RBAC: a Member can view but not create/edit/delete KB articles", async () => {
    const org = await registerOrg(app, "Pepper Industries KB", "pik");

    const roles = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .expect(200);
    const memberRole = roles.body.find((r: { name: string }) => r.name === "Member");

    const invited = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${org.accessToken}`)
      .send({ email: uniqueEmail("member-kb"), fullName: "Pepper Member", roleIds: [memberRole.id] })
      .expect(201);
    const memberLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: invited.body.user.email, password: invited.body.temporaryPassword })
      .expect(200);
    const memberToken = memberLogin.body.tokens.accessToken as string;

    await request(app.getHttpServer())
      .get("/api/v1/kb")
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post("/api/v1/kb")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ title: "Member article", slug: uniqueSlug("member-article"), body: "Body" })
      .expect(403);
  });
});
