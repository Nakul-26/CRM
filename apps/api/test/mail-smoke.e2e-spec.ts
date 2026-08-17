import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./setup/test-app";
import { MailerService } from "../src/shared/mail/mailer.service";
import { clearMailpit, getMessage, waitForMessage } from "./setup/mailpit";

describe("Mail infrastructure smoke test (e2e, real Mailpit)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("sends an email through MailerService and it's fetchable via Mailpit's REST API", async () => {
    await clearMailpit();
    const mailer = app.get(MailerService);
    const to = `smoke-test-${Date.now()}@example.com`;

    await mailer.send({ to, subject: "Mail infra smoke test", html: "<p>Hello from the smoke test</p>", text: "Hello from the smoke test" });

    const summary = await waitForMessage((m) => m.To.some((addr) => addr.Address === to));
    expect(summary.Subject).toBe("Mail infra smoke test");

    const full = await getMessage(summary.ID);
    expect(full.Text).toContain("Hello from the smoke test");
  });

  it("no-ops cleanly when there is no recipient address", async () => {
    const mailer = app.get(MailerService);
    // Should resolve without throwing, and without attempting a send.
    await expect(mailer.send({ to: null, subject: "Should not send", html: "<p>x</p>", text: "x" })).resolves.toBeUndefined();
  });
});
