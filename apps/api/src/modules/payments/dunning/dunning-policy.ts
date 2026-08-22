/**
 * Shared retry schedule for both DunningOrchestrator backends — see
 * docs/decisions/0016-temporal-dunning-phase16-scope.md. Both the Postgres
 * cron backend and the Temporal workflow backend import this so the
 * business outcome (three attempts, day-scale backoff, then cancel) is
 * identical regardless of which system is doing the waiting.
 */
export const MAX_DUNNING_ATTEMPTS = 3;

const PRODUCTION_RETRY_DELAYS_MS = [
  24 * 60 * 60 * 1000, // 1 day
  3 * 24 * 60 * 60 * 1000, // 3 days
  7 * 24 * 60 * 60 * 1000, // 7 days
];

/**
 * DUNNING_RETRY_DELAYS_MS (comma-separated ms) overrides the production
 * day-scale schedule — for e2e tests only, since a test cannot wait out
 * real days. Absent in dev/production.
 */
export function getDunningRetryDelaysMs(override?: string): number[] {
  if (!override) return PRODUCTION_RETRY_DELAYS_MS;
  const parsed = override.split(",").map((value) => Number.parseInt(value.trim(), 10));
  if (parsed.length !== MAX_DUNNING_ATTEMPTS || parsed.some((value) => Number.isNaN(value) || value < 0)) {
    throw new Error(`DUNNING_RETRY_DELAYS_MS must be exactly ${MAX_DUNNING_ATTEMPTS} comma-separated non-negative integers`);
  }
  return parsed;
}
