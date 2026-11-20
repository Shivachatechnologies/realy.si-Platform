import "server-only";
import { getConnection, type Connection } from "../connections";
import { ProviderError } from "../providers";

/**
 * Shared shape of the generic provider services (research, AI text, images, video, storage, messaging, payments).
 * Every service takes (organizationId, companyId) — callers authorize their own feature first — and returns a
 * truthful result: `ok: true` only when a provider accepted the request.
 */

export type ServiceErrorCode = "not_connected" | "provider_error" | "rate_limited" | "invalid_input" | "unsupported";

export type ServiceResult<T> =
  | { ok: true; data: T; providerId: string; attempts: ProviderAttempt[] }
  | { ok: false; error: string; code: ServiceErrorCode; providerId: string | null; attempts: ProviderAttempt[] };

export interface ProviderAttempt {
  providerId: string;
  outcome: "ok" | "not_connected" | "error" | "rate_limited";
  error?: string;
}

/** A connection usable for calls: connected (or erroring but still holding credentials — a success clears the error). */
export async function usableConnection(organizationId: string, companyId: string, provider: string): Promise<(Connection & { accessToken: string }) | null> {
  const c = await getConnection(organizationId, companyId, provider);
  return c && c.status !== "DISCONNECTED" && c.accessToken ? (c as Connection & { accessToken: string }) : null;
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : "provider request failed").slice(0, 300);
export const isRateLimited = (err: unknown) => err instanceof ProviderError && err.status === 429;

/**
 * Circuit breaker per connection (per process): after a provider error or rate limit the connection is skipped for a
 * cool-down, so a failing provider does not slow every request down. Open circuits are still tried as a last resort
 * when no other provider in the chain succeeded (error recovery: a provider that came back is used again at once).
 */
const circuits = new Map<string, { openUntil: number; failures: number }>();
const COOL_DOWN_MS = 30_000;
const MAX_COOL_DOWN_MS = 5 * 60_000;

export function circuitOpen(connectionId: string, now = Date.now()): boolean {
  const c = circuits.get(connectionId);
  return !!c && c.openUntil > now;
}

function tripCircuit(connectionId: string, rateLimited: boolean) {
  const prev = circuits.get(connectionId);
  const failures = (prev?.failures ?? 0) + 1;
  const wait = Math.min(MAX_COOL_DOWN_MS, (rateLimited ? COOL_DOWN_MS * 2 : COOL_DOWN_MS) * 2 ** Math.min(failures - 1, 4));
  circuits.set(connectionId, { openUntil: Date.now() + wait, failures });
  if (circuits.size > 5_000) for (const [k, v] of circuits) if (v.openUntil < Date.now()) circuits.delete(k);
}

const closeCircuit = (connectionId: string) => circuits.delete(connectionId);

/**
 * Try providers in order, skipping unconnected ones and falling back on errors / rate limits.
 * `run` receives the connection and returns the data (throw ProviderError to fall through).
 */
export async function withFallback<T>(
  organizationId: string,
  companyId: string,
  order: readonly string[],
  run: (conn: Connection & { accessToken: string }) => Promise<T>,
): Promise<ServiceResult<T>> {
  const attempts: ProviderAttempt[] = [];
  const deferred: (Connection & { accessToken: string })[] = [];
  const attempt = async (conn: Connection & { accessToken: string }): Promise<ServiceResult<T> | null> => {
    try {
      const data = await run(conn);
      closeCircuit(conn.id);
      attempts.push({ providerId: conn.provider, outcome: "ok" });
      return { ok: true, data, providerId: conn.provider, attempts };
    } catch (err) {
      const limited = isRateLimited(err);
      // Caller mistakes (4xx other than auth/rate limit) say nothing about the provider's health.
      const status = err instanceof ProviderError ? err.status : null;
      if (limited || status === null || status === 401 || status === 403 || status >= 500) tripCircuit(conn.id, limited);
      attempts.push({ providerId: conn.provider, outcome: limited ? "rate_limited" : "error", error: errorText(err) });
      return null;
    }
  };
  for (const providerId of order) {
    const conn = await usableConnection(organizationId, companyId, providerId);
    if (!conn) {
      attempts.push({ providerId, outcome: "not_connected" });
      continue;
    }
    if (circuitOpen(conn.id)) {
      deferred.push(conn);
      continue;
    }
    const r = await attempt(conn);
    if (r) return r;
  }
  // Last resort: providers whose circuit is open (recently failing) get one more try before giving up.
  for (const conn of deferred) {
    const r = await attempt(conn);
    if (r) return r;
  }
  const tried = attempts.filter((a) => a.outcome !== "not_connected");
  if (!tried.length) return { ok: false, code: "not_connected", error: `No provider connected (connect one of: ${order.join(", ")})`, providerId: null, attempts };
  const last = tried[tried.length - 1]!;
  return { ok: false, code: tried.every((a) => a.outcome === "rate_limited") ? "rate_limited" : "provider_error", error: last.error ?? "provider request failed", providerId: last.providerId, attempts };
}

/** Throw a ProviderError for a non-2xx response (keeps the status for fallback decisions). */
export function ensureOk(res: { ok: boolean; status: number; data: unknown }, what: string): void {
  if (res.ok) return;
  const d = res.data as Record<string, unknown> | null;
  const e = d?.error ?? d?.message ?? d?.detail ?? d?.errors;
  const msg = typeof e === "string" ? e : e && typeof e === "object" && "message" in (e as object) ? String((e as { message: unknown }).message) : "";
  throw new ProviderError(`${what} failed (${res.status}${msg ? `: ${msg.slice(0, 160)}` : ""})`, res.status);
}

export const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
