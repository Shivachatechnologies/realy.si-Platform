import "server-only";
import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { consume } from "@/server/core/rate-limit";
import type { Connection } from "./connections";
import { recordCallOutcome } from "./health";
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
  /** Raw body (binary uploads, multipart FormData). Set `headers["content-type"]` for non-FormData bodies. */
  raw?: string | Uint8Array | FormData;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Skip adding the connection's auth header (e.g. signed URLs). */
  noAuth?: boolean;
  /** Do not count this call toward the connection's health (e.g. requests to third-party URLs). */
  skipHealth?: boolean;
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

/** Host + path with long opaque segments masked (paths can carry ids or tokens); the query string is dropped. */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname
      .split("/")
      .map((seg) => (seg.length >= 32 && /^[A-Za-z0-9_\-.~%=]+$/.test(seg) ? "…" : seg))
      .join("/");
    return `${u.host}${path}`.slice(0, 300);
  } catch {
    return "invalid-url";
  }
}

function requestSummary(req: ProviderRequest) {
  if (req.json !== undefined) {
    const keys = req.json && typeof req.json === "object" && !Array.isArray(req.json) ? Object.keys(req.json as object) : null;
    return keys ? `JSON body · fields: ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? "…" : ""}` : "JSON body";
  }
  if (req.form) return `form body · fields: ${Object.keys(req.form).slice(0, 8).join(", ")}`;
  if (req.raw !== undefined) return typeof FormData !== "undefined" && req.raw instanceof FormData ? "multipart body" : `raw body · ${typeof req.raw === "string" ? req.raw.length : req.raw instanceof Uint8Array ? req.raw.byteLength : 0} bytes`;
  return "no body";
}

/** Provider error code/message from a JSON error body (never the body itself). */
function errorCode(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const e = d.error ?? d.errors ?? d.Fault ?? d.message;
  if (typeof e === "string") return e.slice(0, 80);
  if (e && typeof e === "object") {
    const o = (Array.isArray(e) ? e[0] : e) as Record<string, unknown> | undefined;
    const code = o?.code ?? o?.type ?? o?.Message ?? o?.message;
    if (typeof code === "string" || typeof code === "number") return String(code).slice(0, 80);
  }
  return null;
}

interface LogEntry {
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
  attempts: number;
  requestSummary: string;
  responseSummary: string | null;
  error: string | null;
}

/** Record a provider call in the connection's request log (best effort; never throws, never stores secrets or bodies). */
export async function logProviderCall(conn: Pick<Connection, "id" | "provider"> & { organizationId?: string; companyId?: string }, entry: LogEntry): Promise<void> {
  try {
    let scope = conn.organizationId && conn.companyId ? { organizationId: conn.organizationId, companyId: conn.companyId } : null;
    if (!scope) scope = await db().integrationConnection.findUnique({ where: { id: conn.id }, select: { organizationId: true, companyId: true } });
    if (!scope) return;
    await db().integrationRequestLog.create({
      data: {
        ...scope,
        connectionId: conn.id,
        provider: conn.provider,
        method: entry.method,
        url: entry.url,
        status: entry.status,
        durationMs: Math.max(0, Math.round(entry.durationMs)),
        attempts: entry.attempts,
        requestSummary: entry.requestSummary.slice(0, 300),
        responseSummary: entry.responseSummary?.slice(0, 300) ?? null,
        error: entry.error?.slice(0, 300) ?? null,
      },
    });
  } catch (err) {
    logger.warn({ provider: conn.provider, err: err instanceof Error ? err.message : "log failed" }, "integration request log failed");
  }
}

export async function providerFetch<T = unknown>(conn: Connection, url: string, req: ProviderRequest = {}): Promise<ProviderResponse<T>> {
  const started = Date.now();
  const method = req.method ?? (req.json !== undefined || req.form || req.raw !== undefined ? "POST" : "GET");
  let attempts = 0;
  const log = (status: number | null, responseSummary: string | null, error: string | null) =>
    logProviderCall(conn, { method, url: safeUrl(url), status, durationMs: Date.now() - started, attempts, requestSummary: requestSummary(req), responseSummary, error });
  try {
    const res = await providerFetchInner<T>(conn, url, req, () => attempts++);
    const type = res.text && /^\s*[[{]/.test(res.text) ? "JSON" : res.text ? "text" : "empty";
    await log(res.status, `${res.status} · ${type} · ${res.text.length} chars${res.ok ? "" : (errorCode(res.data) ? ` · ${errorCode(res.data)}` : "")}`, null);
    if (!req.skipHealth) await recordCallOutcome(conn, res.status, errorCode(res.data) ? `${new URL(url).host} responded ${res.status} (${errorCode(res.data)})` : null);
    return res;
  } catch (err) {
    const status = err instanceof ProviderError ? err.status : null;
    await log(status, null, err instanceof Error ? err.message : "request failed");
    // The local rate limit (429) and missing credentials are not provider failures.
    if (!req.skipHealth && status !== 429 && status !== 401) await recordCallOutcome(conn, status, err instanceof Error ? err.message : null);
    throw err;
  }
}

async function providerFetchInner<T>(conn: Connection, url: string, req: ProviderRequest, onAttempt: () => void): Promise<ProviderResponse<T>> {
  if (!conn.accessToken && !req.noAuth) throw new ProviderError("connection has no usable credentials", 401);
  const retries = req.retries ?? 3;
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "Realy", ...(req.headers ?? {}) };
  if (!req.noAuth && conn.accessToken) Object.assign(headers, authHeaders(conn.provider, conn.accessToken, conn.config));
  let body: string | Uint8Array | FormData | undefined;
  if (req.raw !== undefined) {
    body = req.raw;
  } else if (req.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(req.json);
  } else if (req.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(req.form).toString();
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    onAttempt();
    await throttle(conn.id);
    try {
      const res = await fetch(url, { method: req.method ?? (body !== undefined ? "POST" : "GET"), headers, body: body as BodyInit | undefined, signal: AbortSignal.timeout(req.timeoutMs ?? 15_000), redirect: "follow" });
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
