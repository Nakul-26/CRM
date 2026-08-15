import type { ApiErrorBody } from "@sales-platform/contracts";

export class ApiError extends Error {
  constructor(public readonly body: ApiErrorBody, public readonly status: number) {
    super(body.error.message);
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/refresh", { method: "POST" })
      .then((res) => res.ok)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * Client-side fetch wrapper for the /api/gateway/* BFF proxy. On a 401 it
 * attempts exactly one silent refresh (deduped across concurrent callers)
 * and retries the original request once before giving up.
 */
export async function apiFetch<T>(path: string, init?: RequestInit, _retried = false): Promise<T> {
  const res = await fetch(`/api/gateway/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });

  if (res.status === 401 && !_retried) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiFetch<T>(path, init, true);
    }
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    throw new ApiError(data as ApiErrorBody, res.status);
  }
  return data as T;
}
