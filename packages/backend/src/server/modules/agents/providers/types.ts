import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AiProviderKey } from "./catalog";

/**
 * The agent runtime speaks one canonical message format — the Anthropic Messages shape (system blocks, user /
 * assistant turns, tool_use / tool_result blocks, usage). Every provider adapter translates a canonical request into
 * its own API and the provider's reply back into a canonical message, so the tool loop, cost ledger, budgets and
 * fallback logic are provider-neutral.
 */
export type ModelRequest = MessageCreateParamsNonStreaming;
export type ModelResponse = BetaMessage;

export interface CallOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ModelProvider {
  key: AiProviderKey;
  /** The platform key is set. */
  configured(): boolean;
  call(req: ModelRequest, opts?: CallOptions): Promise<ModelResponse>;
}

/**
 * A provider HTTP failure. `status` null = network / timeout. Messages never include the provider's response body
 * or credentials (they reach logs and task errors).
 */
export class ProviderHttpError extends Error {
  constructor(
    readonly provider: AiProviderKey,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

/** The platform has no key for the model's provider: try another provider (fallback), never fabricate a reply. */
export class ProviderNotConfigured extends Error {
  constructor(readonly provider: AiProviderKey) {
    super(`${provider} is not configured on this platform`);
  }
}

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;

/** Test seam: replace HTTP for the OpenAI / Gemini adapters with a stub endpoint. Never set outside tests. */
export function setProviderFetchForTests(f: Fetch | null) {
  testFetch = f;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST JSON with a timeout and bounded retries on 429 / 5xx / network errors; returns the parsed body. */
export async function postJson<T>(provider: AiProviderKey, url: string, headers: Record<string, string>, body: unknown, opts: CallOptions = {}): Promise<T> {
  const f = testFetch ?? fetch;
  const retries = opts.maxRetries ?? 2;
  let last: ProviderHttpError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await f(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000) });
    } catch (err) {
      last = new ProviderHttpError(provider, null, `${provider} request failed: ${err instanceof Error ? err.name : "network error"}`);
      if (attempt < retries) {
        await sleep(Math.min(500 * 2 ** attempt, 4_000));
        continue;
      }
      throw last;
    }
    if (res.ok) return (await res.json()) as T;
    // Drain the body without exposing it.
    await res.text().catch(() => "");
    last = new ProviderHttpError(provider, res.status, `${provider} responded ${res.status}`);
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const after = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 8_000) : Math.min(500 * 2 ** attempt, 4_000));
      continue;
    }
    throw last;
  }
  throw last ?? new ProviderHttpError(provider, null, `${provider} request failed`);
}

// ───────────── Canonical content helpers ─────────────

export interface CanonicalTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

type Block = { type: string; [k: string]: unknown };

/** System prompt as plain text (cache markers are Anthropic-only). */
export function systemText(system: ModelRequest["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return (system as { type: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n\n");
}

export function toolsOf(req: ModelRequest): CanonicalTool[] {
  return ((req.tools ?? []) as unknown as { name?: string; description?: string; input_schema?: Record<string, unknown> }[])
    .filter((t) => t.name && t.input_schema)
    .map((t) => ({ name: t.name!, description: t.description ?? "", schema: t.input_schema! }));
}

export const blocksOf = (content: unknown): Block[] => (typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? (content as Block[]) : []);

/** Text of a tool_result's content (string or text blocks). */
export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return (content as Block[]).map((b) => (b.type === "text" ? String(b.text ?? "") : "")).join("\n");
  return "";
}

/** JSON schema requested for structured output (quick calls), if any. */
export function outputSchemaOf(req: ModelRequest): Record<string, unknown> | null {
  const f = (req as unknown as { output_config?: { format?: { type?: string; schema?: Record<string, unknown> } } }).output_config?.format;
  return f?.type === "json_schema" && f.schema ? f.schema : null;
}

export function canonicalMessage(model: string, content: Block[], stop: string, usage: { input: number; output: number; cacheRead: number }): ModelResponse {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 12)}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: usage.input, output_tokens: usage.output, cache_read_input_tokens: usage.cacheRead, cache_creation_input_tokens: 0 },
  } as unknown as ModelResponse;
}
