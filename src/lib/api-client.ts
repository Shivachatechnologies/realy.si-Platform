"use client";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
  }

  /** Zod issue paths → first message, for inline field errors. */
  fieldErrors(): Record<string, string> {
    const issues = (this.details?.issues as { path: string; message: string }[] | undefined) ?? [];
    const out: Record<string, string> = {};
    for (const i of issues) if (!(i.path in out)) out[i.path] = i.message;
    return out;
  }
}

/** Call Realy's API. Same-origin cookies authenticate; errors arrive as the structured envelope (docs/api.md). */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("network", "Network error");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(e.code ?? "internal_error", e.message ?? res.statusText, e.details, e.requestId);
  }
  return data as T;
}

export function setCookie(name: string, value: string, maxAgeDays = 365) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeDays * 86400}; SameSite=Lax${secure}`;
}
