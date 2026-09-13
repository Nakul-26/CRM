import { z } from "zod";

/**
 * `z.coerce.boolean()` does a raw `Boolean(value)` coercion — so the
 * *string* "false" (non-empty) parses to `true`, the opposite of what an
 * env-var reader needs. Discovered when NOTIFICATIONS_SERVICE_ENABLED's
 * boot-time validation (Phase 18) started throwing on every e2e spec: every
 * test file sets it via `process.env.NOTIFICATIONS_SERVICE_ENABLED ??=
 * "false"`, and that literal string "false" was being coerced straight to
 * `true`. AUTH_OIDC_ENABLED/NEXT_PUBLIC_OIDC_ENABLED had the identical
 * latent bug since Phase 17 — harmless there only because nothing else ever
 * asserted on either being `false`. This helper treats only the literal
 * string "true" (or a real boolean `true`) as true.
 */
function booleanFlag(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined) return defaultValue;
    if (typeof value === "string") return value === "true";
    return value;
  }, z.boolean());
}

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url(),

  REDIS_URL: z.string().url().default("redis://localhost:6380"),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),

  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().default("no-reply@sales-platform.local"),

  WEB_APP_URL: z.string().url().default("http://localhost:3000"),

  // Only STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET are needed when
  // PAYMENT_PROVIDER=stripe; the mock provider (default) needs neither.
  PAYMENT_PROVIDER: z.enum(["mock", "stripe"]).default("mock"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // INBOUND_EMAIL_DOMAIN only shapes the Reply-To address stamped on
  // outbound ticket emails going forward — harmless if never used.
  // INBOUND_EMAIL_WEBHOOK_SECRET gates POST /support/inbound-email: unset
  // (default) means the endpoint rejects every request, so this feature is
  // inert until a real inbound-email-parsing provider (e.g. a
  // Postmark/Mailgun inbound route) is configured to forward parsed
  // replies here with this secret. See
  // docs/decisions/0021-inbound-email-ticket-parsing-phase21-scope.md.
  INBOUND_EMAIL_DOMAIN: z.string().default("inbound.sales-platform.local"),
  INBOUND_EMAIL_WEBHOOK_SECRET: z.string().optional(),

  // Only RABBITMQ_URL is needed when EVENT_BUS_TRANSPORT=rabbitmq; the
  // in-process default (EventEmitter2 only) needs neither.
  EVENT_BUS_TRANSPORT: z.enum(["in-process", "rabbitmq"]).default("in-process"),
  RABBITMQ_URL: z.string().optional(),

  // Only OPENSEARCH_URL is needed when SEARCH_PROVIDER=opensearch; the
  // Postgres default (tsvector + pg_trgm) needs neither.
  SEARCH_PROVIDER: z.enum(["postgres", "opensearch"]).default("postgres"),
  OPENSEARCH_URL: z.string().optional(),

  // Only TEMPORAL_ADDRESS/TEMPORAL_NAMESPACE are needed when
  // WORKFLOW_ENGINE=temporal; the in-process default (Postgres cron table)
  // needs neither. DUNNING_RETRY_DELAYS_MS (comma-separated ms) overrides
  // the production day-scale backoff schedule — for e2e tests only.
  WORKFLOW_ENGINE: z.enum(["in-process", "temporal"]).default("in-process"),
  TEMPORAL_ADDRESS: z.string().optional(),
  TEMPORAL_NAMESPACE: z.string().optional(),
  DUNNING_RETRY_DELAYS_MS: z.string().optional(),

  // Additive, not a swap: password login always works. When enabled, an
  // already-provisioned local user (matched by verified email) can also
  // obtain a token pair via a Keycloak/OIDC login — see
  // docs/decisions/0017-keycloak-oidc-phase17-scope.md.
  AUTH_OIDC_ENABLED: booleanFlag(false),
  OIDC_ISSUER_URL: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),

  // Additive, not a swap: when false (default) apps/api's own
  // NotificationsModule keeps serving /notifications exactly as before, in
  // process, and none of the below matters. When true, apps/api drops its
  // own NotificationsModule entirely and a separately-deployed
  // apps/notifications-service becomes the sole owner of notification
  // storage and the /notifications API, fed via the domain.events RabbitMQ
  // exchange (which requires EVENT_BUS_TRANSPORT=rabbitmq — validated at
  // boot). See docs/decisions/0018-microservices-split-phase18-scope.md.
  NOTIFICATIONS_SERVICE_ENABLED: booleanFlag(false),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = apiEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/**
 * Env for the extracted apps/notifications-service app (Phase 18). A
 * separate schema, not folded into apiEnvSchema, because this process only
 * ever runs at all when the split is turned on — every field here is
 * required, unlike apiEnvSchema's opt-in fields which stay optional because
 * apps/api runs fine without them.
 */
export const notificationsServiceEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4002),
  DATABASE_URL: z.string().url(),
  RABBITMQ_URL: z.string(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

export type NotificationsServiceEnv = z.infer<typeof notificationsServiceEnvSchema>;

export function loadNotificationsServiceEnv(source: NodeJS.ProcessEnv = process.env): NotificationsServiceEnv {
  const parsed = notificationsServiceEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const webEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),

  // The only client-visible OIDC flag — toggles whether the "Sign in with
  // SSO" button renders. Building the actual Keycloak redirect happens
  // server-side in /api/auth/oidc/start (see server-config.ts's
  // OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_REDIRECT_URI, which are
  // deliberately NOT NEXT_PUBLIC_ — same "server-only" posture as
  // API_INTERNAL_URL).
  NEXT_PUBLIC_OIDC_ENABLED: booleanFlag(false),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
