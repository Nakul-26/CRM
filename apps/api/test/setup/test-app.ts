import "reflect-metadata";
import postgres from "postgres";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://sales_platform:sales_platform@localhost:5434/sales_platform";
const TEST_DB_NAME = process.env.TEST_DATABASE_NAME ?? "sales_platform_test";
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB_NAME}`);

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-at-least-32-characters-long";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-at-least-32-characters-long";
process.env.JWT_ACCESS_TTL ??= "15m";
process.env.JWT_REFRESH_TTL ??= "30d";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
// Set (but PAYMENT_PROVIDER left at its "mock" default) so the Stripe
// webhook route's signature verification — pure/local, no network — can
// still be exercised in e2e tests regardless of which provider is active
// for checkout creation.
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_test_secret_for_e2e_signature_verification";
// Left at its "in-process" default for every spec except rabbitmq-audit.e2e-spec.ts,
// which sets EVENT_BUS_TRANSPORT=rabbitmq (and RABBITMQ_URL) before importing this
// file — ??= means that override wins there and every other spec is unaffected.
process.env.EVENT_BUS_TRANSPORT ??= "in-process";
// Same idiom: left at its "postgres" default for every spec except
// search-opensearch.e2e-spec.ts, which sets SEARCH_PROVIDER=opensearch (and
// OPENSEARCH_URL) before importing this file.
process.env.SEARCH_PROVIDER ??= "postgres";
// Same idiom: left at its "in-process" default for every spec except
// dunning-temporal.e2e-spec.ts, which sets WORKFLOW_ENGINE=temporal (and
// TEMPORAL_ADDRESS/DUNNING_RETRY_DELAYS_MS) before importing this file.
process.env.WORKFLOW_ENGINE ??= "in-process";
// Same idiom: left disabled for every spec except oidc-login.e2e-spec.ts,
// which sets AUTH_OIDC_ENABLED=true (and OIDC_ISSUER_URL/OIDC_CLIENT_ID/
// OIDC_CLIENT_SECRET) before importing this file.
process.env.AUTH_OIDC_ENABLED ??= "false";
// Same idiom: left disabled for every spec except
// notifications-service-split.e2e-spec.ts, which sets
// NOTIFICATIONS_SERVICE_ENABLED=true (and EVENT_BUS_TRANSPORT=rabbitmq)
// before importing this file.
process.env.NOTIFICATIONS_SERVICE_ENABLED ??= "false";

let prepared = false;

async function ensureTestDatabase(): Promise<void> {
  if (prepared) return;

  const admin = postgres(ADMIN_URL, { max: 1 });
  const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB_NAME}`;
  if (exists.length === 0) {
    await admin.unsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
  }
  await admin.end();

  // Imported lazily so DATABASE_URL is already overridden before any module
  // that reads it (e.g. @sales-platform/config) is evaluated.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runMigrations } = require("../../src/database/migrate");
  await runMigrations(TEST_DATABASE_URL);

  prepared = true;
}

export async function createTestApp(): Promise<INestApplication> {
  await ensureTestDatabase();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AppModule } = require("../../src/app.module");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  // Must mirror main.ts's bootstrap exactly, or routes exist at the wrong
  // path under test (this bit us: /auth/register instead of /api/v1/auth/register).
  app.setGlobalPrefix("api/v1");
  await app.init();
  return app;
}
