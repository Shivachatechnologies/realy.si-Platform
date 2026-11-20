/**
 * Shared HTTP helper for marketing provider adapters. A call counts as successful only on a 2xx response; anything else
 * throws a ProviderError with a short, user-safe reason code (and a detail without secrets).
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

export async function call(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<CallResult> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ProviderError("provider_unreachable");
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    const parsed = text ? JSON.parse(text) : {};
    json = Array.isArray(parsed) ? { items: parsed } : (parsed as Record<string, unknown>);
  } catch {
    json = {};
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError("provider_unauthorized", `HTTP ${res.status}${detailOf(json)}`);
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after"));
    throw new ProviderError("provider_rate_limited", "HTTP 429", Number.isFinite(ra) && ra > 0 ? ra : undefined);
  }
  if (res.status >= 500) throw new ProviderError("provider_unavailable", `HTTP ${res.status}${detailOf(json)}`);
  if (!res.ok) throw new ProviderError("provider_rejected", `HTTP ${res.status}${detailOf(json)}`);
  return { status: res.status, headers: res.headers, json };
}

/** Binary download (generated images / media) with a size cap. */
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
