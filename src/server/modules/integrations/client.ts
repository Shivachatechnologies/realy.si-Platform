import "server-only";
import { consume } from "@/server/core/rate-limit";
import type { Connection } from "./connections";
import { authHeaders, ProviderError } from "./providers";

/**
 * Provider API client: per-request timeout, retries with exponential backoff (honouring Retry-After) on network
 * errors, 429 and 5xx, and a per-connection rate limit (Redis sliding window shared by web and worker).
 */

export interface ProviderRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON body (sent as application/json) or a pre-encoded form. */
  json?: unknown;
  form?: Record<string, string>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Skip adding the connection's auth header (e.g. signed URLs). */
  noAuth?: boolean;
}

export interface ProviderResponse<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
  text: string;
}

const PER_CONNECTION = { name: "integration-api", limit: 120, windowMs: 60_000 };
const MAX_BACKOFF_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  const secs = header ? Number(header) : NaN;
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_BACKOFF_MS);
  return Math.min(500 * 2 ** attempt + Math.floor(Math.random() * 250), MAX_BACKOFF_MS);
}

/** Wait for a slot in the connection's rate-limit window (bounded), or fail. */
async function throttle(connectionId: string) {
  for (let i = 0; i < 3; i++) {
    const r = await consume(PER_CONNECTION, connectionId);
    if (r.allowed) return;
    await sleep(Math.min(r.resetSeconds * 1000, 5_000));
  }
  throw new ProviderError("rate limit for this connection exceeded; try again shortly", 429);
}

export async function providerFetch<T = unknown>(conn: Connection, url: string, req: ProviderRequest = {}): Promise<ProviderResponse<T>> {
  if (!conn.accessToken && !req.noAuth) throw new ProviderError("connection has no usable credentials", 401);
  const retries = req.retries ?? 3;
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "Realy", ...(req.headers ?? {}) };
  if (!req.noAuth && conn.accessToken) Object.assign(headers, authHeaders(conn.provider, conn.accessToken, conn.config));
  let body: string | undefined;
  if (req.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(req.json);
  } else if (req.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(req.form).toString();
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(conn.id);
    try {
      const res = await fetch(url, { method: req.method ?? (body ? "POST" : "GET"), headers, body, signal: AbortSignal.timeout(req.timeoutMs ?? 15_000), redirect: "follow" });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(retryAfterMs(res, attempt));
        continue;
      }
      const text = await res.text();
      let data: unknown = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // non-JSON body: keep the text
      }
      return { status: res.status, ok: res.ok, data: data as T, text: text.slice(0, 20_000) };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS));
        continue;
      }
    }
  }
  throw new ProviderError(`request to ${new URL(url).host} failed: ${lastError instanceof Error ? lastError.message : "network error"}`);
}

/** Like providerFetch but throws ProviderError on a non-2xx response. */
export async function providerJson<T = Record<string, unknown>>(conn: Connection, url: string, req: ProviderRequest = {}): Promise<T> {
  const res = await providerFetch<T>(conn, url, req);
  if (!res.ok) throw new ProviderError(`${new URL(url).host} responded ${res.status}`, res.status);
  return res.data;
}
