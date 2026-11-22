"use client";

import { ApiError } from "@/lib/api-client";

export type StreamAnswerEvent<R> =
  | { type: "route"; intent: string; routedBy: string; language: string }
  | { type: "sentence"; index: number; text: string }
  | ({ type: "result"; streamedSentences: number } & R)
  | { type: "error"; code: string; message: string; details: Record<string, unknown> | null };

/**
 * POST one utterance to the streaming answer route and read its newline-delimited JSON events as they arrive
 * (`onEvent` for route and sentence events). Resolves with the final result; rejects with ApiError like `api()`.
 */
export async function streamUtterance<R>(url: string, body: unknown, onEvent: (e: StreamAnswerEvent<R>) => void, signal?: AbortSignal): Promise<R & { streamedSentences: number }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", signal });
  } catch {
    throw new ApiError("network", "Network error");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: Record<string, unknown>; requestId?: string } } | null;
    const e = data?.error ?? {};
    throw new ApiError(e.code ?? "internal_error", e.message ?? res.statusText, e.details, e.requestId);
  }
  let result: (R & { streamedSentences: number }) | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let ev: StreamAnswerEvent<R>;
    try {
      ev = JSON.parse(line) as StreamAnswerEvent<R>;
    } catch {
      return;
    }
    if (ev.type === "error") throw new ApiError(ev.code, ev.message, ev.details ?? undefined);
    if (ev.type === "result") result = ev as R & { streamedSentences: number };
    else onEvent(ev);
  };
  if (res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    handle(buf + dec.decode());
  } else {
    for (const line of (await res.text()).split("\n")) handle(line);
  }
  if (!result) throw new ApiError("internal_error", "The answer stream ended early");
  return result;
}
