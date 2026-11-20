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
  for (const providerId of order) {
    const conn = await usableConnection(organizationId, companyId, providerId);
    if (!conn) {
      attempts.push({ providerId, outcome: "not_connected" });
      continue;
    }
    try {
      const data = await run(conn);
      attempts.push({ providerId, outcome: "ok" });
      return { ok: true, data, providerId, attempts };
    } catch (err) {
      attempts.push({ providerId, outcome: isRateLimited(err) ? "rate_limited" : "error", error: errorText(err) });
    }
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
