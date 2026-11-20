import { providerFetch } from "@/server/modules/integrations/client";
import type { Connection } from "@/server/modules/integrations/connections";
import { ProviderError as IntegrationError } from "@/server/modules/integrations/providers";

/**
 * Marketing's thin layer over the Integrations provider client (providerFetch: request log, per-connection rate limit,
 * retries with backoff, connection health). A call counts as successful only on a 2xx response; anything else throws a
 * ProviderError with a short, user-safe reason code (and a detail without secrets).
 */
export class ProviderError extends Error {
  constructor(
    readonly reason: string,
    message?: string,
    /** Seconds to wait before retrying (rate limits). */
    readonly retryAfter?: number,
  ) {
    super(message ?? reason);
  }
}

/** Errors worth retrying with backoff. */
export const isTransient = (err: unknown) => err instanceof ProviderError && ["provider_rate_limited", "provider_unreachable", "provider_unavailable"].includes(err.reason);

export interface CallResult {
  status: number;
  headers: Headers;
  json: Record<string, unknown>;
}

export interface CallInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | FormData | URLSearchParams;
  /** Retries on 429/5xx/network errors. Default: 2 for reads, 0 for writes (a retried publish could post twice). */
  retries?: number;
  /** The request authenticates itself (key in the body, signed upload URL): do not add the connection's auth header. */
  noAuth?: boolean;
}

const AUTH_HEADER = /^(authorization|x-api-key|x-shopify-access-token|access-token)$/i;
const TOKEN_IN_URL = /[?&](access_token|api_key)=/;

/**
 * One provider API request through the Integrations client with the given connection. Explicit auth headers (or a token
 * in the query / form body) are kept as given; otherwise the Integrations auth scheme of the connection's provider applies.
 */
export async function call(conn: Connection, url: string, init: CallInit = {}, timeoutMs = 20_000): Promise<CallResult> {
  const method = (init.method ?? (init.body !== undefined ? "POST" : "GET")).toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  const headers = init.headers ?? {};
  const tokenInBody = init.body instanceof URLSearchParams && init.body.has("access_token");
  const body = init.body instanceof URLSearchParams ? init.body.toString() : init.body;
  const noAuth = !!init.noAuth || tokenInBody || TOKEN_IN_URL.test(url) || Object.keys(headers).some((k) => AUTH_HEADER.test(k));
  let res;
  try {
    res = await providerFetch<unknown>(conn, url, { method, headers, raw: body, timeoutMs, retries: init.retries ?? (method === "GET" ? 2 : 0), noAuth });
  } catch (err) {
    if (err instanceof IntegrationError && err.status === 429) throw new ProviderError("provider_rate_limited", err.message);
    if (err instanceof IntegrationError && err.status === 401) throw new ProviderError("provider_unauthorized", err.message);
    throw new ProviderError("provider_unreachable");
  }
  const parsed = res.data;
  const json: Record<string, unknown> = Array.isArray(parsed) ? { items: parsed } : parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const resHeaders = res.headers ?? new Headers();
  if (res.status === 401 || res.status === 403) throw new ProviderError("provider_unauthorized", `HTTP ${res.status}${detailOf(json)}`);
  if (res.status === 429) {
    const ra = Number(resHeaders.get("retry-after"));
    throw new ProviderError("provider_rate_limited", "HTTP 429", Number.isFinite(ra) && ra > 0 ? ra : undefined);
  }
  if (res.status >= 500) throw new ProviderError("provider_unavailable", `HTTP ${res.status}${detailOf(json)}`);
  if (!res.ok) throw new ProviderError("provider_rejected", `HTTP ${res.status}${detailOf(json)}`);
  return { status: res.status, headers: resHeaders, json };
}

/**
 * Binary download of media from a public or provider-hosted output URL (generated videos, imports, stored objects) with
 * a size cap. Not a provider API call (no credentials), so it does not go through the provider client.
 */
export async function download(url: string, maxBytes = 15 * 1024 * 1024, headers?: Record<string, string>): Promise<{ bytes: Buffer; mimeType: string }> {
  if (!/^https:\/\//i.test(url)) throw new ProviderError("media_url_invalid");
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new ProviderError("provider_unreachable");
  }
  if (!res.ok) throw new ProviderError("media_download_failed", `HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new ProviderError("media_too_large");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > maxBytes) throw new ProviderError("media_too_large");
  return { bytes, mimeType: res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream" };
}

function detailOf(json: Record<string, unknown>): string {
  const err = json.error as { message?: string } | string | undefined;
  const detail =
    typeof err === "string"
      ? err
      : (err?.message ?? (json.detail as string | undefined) ?? (json.message as string | undefined) ?? (json.error_description as string | undefined) ?? (json.errors ? JSON.stringify(json.errors).slice(0, 200) : ""));
  return detail ? `: ${String(detail).slice(0, 200)}` : "";
}

/** Marketing ProviderError from an Integrations service failure (ServiceResult with ok: false). */
export function serviceError(r: { code: string; error: string }): ProviderError {
  const reason = r.code === "not_connected" ? "not_connected" : r.code === "rate_limited" ? "provider_rate_limited" : r.code === "invalid_input" ? "invalid_input" : "provider_rejected";
  return new ProviderError(reason, r.error);
}

export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
export const str = (v: unknown) => (typeof v === "string" && v ? v : null);
export const cfg = (c: { config: Record<string, unknown> }, ...keys: string[]) => {
  for (const k of keys) {
    const v = str(c.config[k]);
    if (v) return v;
  }
  return null;
};
export const bearer = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
