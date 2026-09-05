// Must run before any other import — test-app.ts reads these via `??=`, so
// setting them here (before it's imported, even transitively) is what makes
// this one spec file exercise NOTIFICATIONS_SERVICE_ENABLED=true while every
// other spec file keeps using the default (module stays mounted in-process).
//
// Under `--runInBand` every spec file shares one Node process, so
// `process.env` mutations here would otherwise leak into every spec file
// that runs afterward in the same process — the `afterAll` below restores
// the previous values so this file's opt-in doesn't poison the rest of the
// suite.
const PREVIOUS_ENV = {
  NOTIFICATIONS_SERVICE_ENABLED: process.env.NOTIFICATIONS_SERVICE_ENABLED,
  EVENT_BUS_TRANSPORT: process.env.EVENT_BUS_TRANSPORT,
  RABBITMQ_URL: process.env.RABBITMQ_URL,
};
process.env.NOTIFICATIONS_SERVICE_ENABLED = "true";
process.env.EVENT_BUS_TRANSPORT ??= "rabbitmq";
process.env.RABBITMQ_URL ??= "amqp://guest:guest@localhost:5673";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./setup/test-app";

function restoreEnvVar(key: keyof typeof PREVIOUS_ENV): void {
  const value = PREVIOUS_ENV[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/**
 * Proves the two halves of Phase 18's opt-in split actually work, from
 * apps/api's side (apps/notifications-service has its own separate e2e
 * suite for the "events genuinely arrive and get served" half — see
 * apps/notifications-service/test/notifications.e2e-spec.ts). See
 * docs/decisions/0018-microservices-split-phase18-scope.md.
 *
 * Generous, not tightly tuned: this spec's `createTestApp()` boots the full
 * AppModule with a real RabbitMQ consumer attached (EVENT_BUS_TRANSPORT=
 * rabbitmq is a prerequisite here) — the same cost every other spec in this
 * suite pays, but observed to occasionally exceed Jest's default 30s under
 * this machine's load. See dunning-temporal.e2e-spec.ts's own comment on
 * the same class of variance.
 */
jest.setTimeout(90000);
describe("Notifications microservices split (e2e)", () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it("drops the in-process NotificationsModule entirely when NOTIFICATIONS_SERVICE_ENABLED=true — the route plainly 404s, not just an empty result", async () => {
    app = await createTestApp();

    // A real, valid token (not just "any request gets rejected") so a 404
    // here unambiguously means the route itself is gone, not that
    // JwtAuthGuard rejected it first.
    const email = `notif-split-${Date.now()}@example.com`;
    const register = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ organizationName: "Notif Split Co", fullName: "Split Owner", email, password: "SuperSecret123" })
      .expect(201);
    const token = register.body.tokens.accessToken as string;

    await request(app.getHttpServer()).get("/api/v1/notifications").set("Authorization", `Bearer ${token}`).expect(404);
  });
});

describe("Notifications microservices split — misconfiguration (e2e)", () => {
  it("fails fast at boot when NOTIFICATIONS_SERVICE_ENABLED=true but EVENT_BUS_TRANSPORT is left at the in-process default", () => {
    jest.resetModules();
    process.env.EVENT_BUS_TRANSPORT = "in-process";

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("../src/app.module");
    }).toThrow(/NOTIFICATIONS_SERVICE_ENABLED=true requires EVENT_BUS_TRANSPORT=rabbitmq/);

    process.env.EVENT_BUS_TRANSPORT = "rabbitmq";
  });
});

// Runs once after every test in this file — restores whatever
// NOTIFICATIONS_SERVICE_ENABLED/EVENT_BUS_TRANSPORT/RABBITMQ_URL were before
// this file ran, so a shared-process run (`--runInBand`, or any worker that
// reuses this process for a later spec file) doesn't inherit this file's
// opt-in flag.
afterAll(() => {
  restoreEnvVar("NOTIFICATIONS_SERVICE_ENABLED");
  restoreEnvVar("EVENT_BUS_TRANSPORT");
  restoreEnvVar("RABBITMQ_URL");
});
