import "server-only";
import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { guardedFetch, OutboundBlockedError } from "@/server/core/outbound";
import { consume } from "@/server/core/rate-limit";
import type { Connection } from "./connections";
import { recordCallOutcome } from "./health";
import { authHeaders, ProviderError } from "./providers";
import { assertLimit, recordUsage as recordPlanUsage } from "@/server/modules/entitlements/service";

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
  /** Known cost of this call in USD cents (paid providers): checked against and metered on the plan's API spend cap. */
  costCents?: number;
  /** Read the response body as bytes (audio, video, files) into `bytes`; `text`/`data` stay empty. */
  binary?: boolean;
}

/** Per-call cost (USD cents, rounded up) of paid research providers whose every call is a billed search. */
const PAID_CALL_CENTS: Record<string, number> = { tavily: 1, exa: 1, serpapi: 2 };

export interface ProviderResponse<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
  text: string;
  /** Response headers (ids returned only in headers, e.g. LinkedIn x-restli-id, upload session Location). */
  headers?: Headers;
  /** Response body bytes when the request set `binary` (successful responses only). */
  bytes?: Uint8Array;
}

const PER_CONNECTION = { name: "integration-api", limit: 120, windowMs: 60_000 };

/**
 * Per-provider limits, kept below each provider's published per-account quota so Realy backs off before the provider
 * starts rejecting (429) — counted per connection, on top of PER_CONNECTION. Providers not listed use PER_CONNECTION.
 */
export const PROVIDER_RATE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  hubspot: { limit: 90, windowMs: 10_000 },
  salesforce: { limit: 600, windowMs: 60_000 },
  slack: { limit: 50, windowMs: 60_000 },
  shopify: { limit: 100, windowMs: 60_000 },
  webflow: { limit: 55, windowMs: 60_000 },
  mailchimp: { limit: 300, windowMs: 60_000 },
  sendgrid: { limit: 500, windowMs: 60_000 },
  xero: { limit: 55, windowMs: 60_000 },
  quickbooks: { limit: 400, windowMs: 60_000 },
  linkedin: { limit: 90, windowMs: 60_000 },
  linkedin_ads: { limit: 90, windowMs: 60_000 },
  x: { limit: 45, windowMs: 15 * 60_000 },
  facebook: { limit: 180, windowMs: 60 * 60_000 },
  instagram: { limit: 180, windowMs: 60 * 60_000 },
  threads: { limit: 180, windowMs: 60 * 60_000 },
  meta_ads: { limit: 180, windowMs: 60 * 60_000 },
  pinterest: { limit: 900, windowMs: 60 * 60_000 },
  google: { limit: 500, windowMs: 60_000 },
  google_ads: { limit: 300, windowMs: 60_000 },
  youtube: { limit: 300, windowMs: 60_000 },
  microsoft: { limit: 500, windowMs: 60_000 },
  stripe: { limit: 80, windowMs: 1_000 },
  razorpay: { limit: 20, windowMs: 1_000 },
  twilio: { limit: 90, windowMs: 1_000 },
  whatsapp: { limit: 70, windowMs: 1_000 },
  openai: { limit: 450, windowMs: 60_000 },
  gemini: { limit: 300, windowMs: 60_000 },
  tavily: { limit: 90, windowMs: 60_000 },
  exa: { limit: 60, windowMs: 60_000 },
  serpapi: { limit: 50, windowMs: 60_000 },
  apollo: { limit: 45, windowMs: 60_000 },
  hunter: { limit: 10, windowMs: 1_000 },
  pdl: { limit: 90, windowMs: 60_000 },
  stability: { limit: 140, windowMs: 10_000 },
  replicate: { limit: 500, windowMs: 60_000 },
  runway: { limit: 20, windowMs: 60_000 },
  openrouter: { limit: 300, windowMs: 60_000 },
  openai_compatible: { limit: 120, windowMs: 60_000 },
  elevenlabs: { limit: 100, windowMs: 60_000 },
  deepgram: { limit: 90, windowMs: 60_000 },
  luma: { limit: 20, windowMs: 60_000 },
  kling: { limit: 20, windowMs: 60_000 },
  shotstack: { limit: 9, windowMs: 1_000 },
  creatomate: { limit: 25, windowMs: 10_000 },
  twilio_voice: { limit: 90, windowMs: 1_000 },
  pipedrive: { limit: 70, windowMs: 2_000 },
  notion: { limit: 3, windowMs: 1_000 },
  clickup: { limit: 90, windowMs: 60_000 },
  calendly: { limit: 100, windowMs: 60_000 },
  google_drive: { limit: 500, windowMs: 60_000 },
  zendesk: { limit: 180, windowMs: 60_000 },
  intercom: { limit: 160, windowMs: 10_000 },
  plaid: { limit: 50, windowMs: 60_000 },
  wise: { limit: 50, windowMs: 60_000 },
  zapier: { limit: 30, windowMs: 60_000 },
  make: { limit: 30, windowMs: 60_000 },
  n8n: { limit: 60, windowMs: 60_000 },
};

/** The effective limits of a provider's connections (per-connection rule + provider rule when listed). */
export function providerRateLimit(provider: string): { limit: number; windowMs: number } {
  const p = PROVIDER_RATE_LIMITS[provider];
  if (!p) return { limit: PER_CONNECTION.limit, windowMs: PER_CONNECTION.windowMs };
  // Compare per minute and report the stricter one.
  const perMin = (r: { limit: number; windowMs: number }) => (r.limit * 60_000) / r.windowMs;
  return perMin(p) < perMin(PER_CONNECTION) ? p : { limit: PER_CONNECTION.limit, windowMs: PER_CONNECTION.windowMs };
}
const MAX_BACKOFF_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  const secs = header ? Number(header) : NaN;
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_BACKOFF_MS);
  return Math.min(500 * 2 ** attempt + Math.floor(Math.random() * 250), MAX_BACKOFF_MS);
}

/** Wait for a slot in the connection's rate-limit windows (bounded), or fail. */
async function throttle(connectionId: string, provider?: string) {
  const providerRule = provider && PROVIDER_RATE_LIMITS[provider] ? { name: `integration-api:${provider}`, ...PROVIDER_RATE_LIMITS[provider] } : null;
  for (let i = 0; i < 3; i++) {
    const r = await consume(PER_CONNECTION, connectionId);
    const p = r.allowed && providerRule ? await consume(providerRule, connectionId) : null;
    if (r.allowed && (!p || p.allowed)) return;
    await sleep(Math.min((p && !p.allowed ? p.resetSeconds : r.resetSeconds) * 1000, 5_000));
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
export async function logProviderCall(conn: Pick<Connection, "id" | "provider"> & { organizationId?: string; companyId?: string; platform?: boolean }, entry: LogEntry): Promise<void> {
  // Platform connections (platform-managed providers) have no connection row to attach the log to.
  if (conn.platform) return;
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
  // Plan API spend cap (docs/entitlements.md): before a paid call, refuse when it would exceed the month's cap.
  const costCents = Math.ceil(req.costCents ?? PAID_CALL_CENTS[conn.provider] ?? 0);
  if (costCents > 0 && conn.organizationId) await assertLimit(null, conn.organizationId, "api.cost.month", costCents);
  try {
    const res = await providerFetchInner<T>(conn, url, req, () => attempts++);
    if (costCents > 0 && conn.organizationId && res.ok) {
      await recordPlanUsage(conn.organizationId, "api.cost_cents", costCents, { companyId: conn.companyId }).catch((e) => logger.warn({ provider: conn.provider, err: e instanceof Error ? e.message : String(e) }, "API spend not metered"));
    }
    const type = res.bytes ? "binary" : res.text && /^\s*[[{]/.test(res.text) ? "JSON" : res.text ? "text" : "empty";
    await log(res.status, `${res.status} · ${type} · ${res.bytes ? `${res.bytes.byteLength} bytes` : `${res.text.length} chars`}${res.ok ? "" : (errorCode(res.data) ? ` · ${errorCode(res.data)}` : "")}`, null);
    if (!req.skipHealth && !conn.platform) await recordCallOutcome(conn, res.status, errorCode(res.data) ? `${new URL(url).host} responded ${res.status} (${errorCode(res.data)})` : null);
    return res;
  } catch (err) {
    const status = err instanceof ProviderError ? err.status : null;
    await log(status, null, err instanceof Error ? err.message : "request failed");
    // The local rate limit (429) and missing credentials are not provider failures.
    if (!req.skipHealth && !conn.platform && status !== 429 && status !== 401) await recordCallOutcome(conn, status, err instanceof Error ? err.message : null);
    throw err;
  }
}

/** Providers whose request host comes from the customer's own configuration (base URL, site URL, hook URL, S3 endpoint). */
const CUSTOMER_HOST_PROVIDERS = new Set(["custom_api", "openai_compatible", "wordpress", "n8n", "zapier", "make", "webhook"]);

export function isCustomerHost(conn: Pick<Connection, "provider" | "config">): boolean {
  return CUSTOMER_HOST_PROVIDERS.has(conn.provider) || (conn.provider === "s3" && typeof conn.config?.endpoint === "string" && conn.config.endpoint !== "");
}

const safeHost = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "endpoint";
  }
};

/**
 * SSRF guard (core/outbound): customer-configured hosts connect through the pinned, address-checking transport; fixed
 * provider hosts use fetch. Either way redirects are followed manually and every hop is checked (credentials are
 * dropped on a cross-origin hop).
 */
function outboundFetch(conn: Connection, url: string, init: { method: string; headers: Record<string, string>; body: BodyInit | undefined; signal: AbortSignal }) {
  return guardedFetch(url, { ...init, redirect: "follow" }, isCustomerHost(conn) ? { maxBytes: 100 * 1024 * 1024 } : { transport: "fetch", trustFirstHop: true });
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
    await throttle(conn.id, conn.provider);
    try {
      const res = await outboundFetch(conn, url, { method: req.method ?? (body !== undefined ? "POST" : "GET"), headers, body: body as BodyInit | undefined, signal: AbortSignal.timeout(req.timeoutMs ?? 15_000) });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(retryAfterMs(res, attempt));
        continue;
      }
      if (req.binary && res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        return { status: res.status, ok: true, data: null as T, text: "", headers: res.headers, bytes };
      }
      const text = await res.text();
      let data: unknown = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // non-JSON body: keep the text
      }
      return { status: res.status, ok: res.ok, data: data as T, text: text.slice(0, 20_000), headers: res.headers };
    } catch (err) {
      // A refused target (private address, bad redirect) is permanent: never retried.
      if (err instanceof OutboundBlockedError) throw new ProviderError(`request to ${safeHost(url)} refused: ${err.message}`, 400);
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
