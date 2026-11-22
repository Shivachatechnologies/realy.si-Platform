import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/server/core/env";
import { keyFingerprint } from "@/server/core/platform-secrets";
import { ProviderNotConfigured, type CallOptions, type ModelProvider, type ModelRequest } from "./types";

/** Anthropic adapter: the canonical format is the Messages API itself (beta endpoint for caching, compaction, fallbacks). */
let client: { c: Anthropic; fp: string } | null = null;

export const anthropicProvider: ModelProvider = {
  key: "anthropic",
  configured: () => !!env().ANTHROPIC_API_KEY,
  call(req: ModelRequest, opts?: CallOptions) {
    const key = env().ANTHROPIC_API_KEY;
    if (!key) throw new ProviderNotConfigured("anthropic");
    // SDK retries connection errors, 408/409/429 and 5xx twice per call; the queue retries the whole task after that.
    // Rebuilt when the key changes (Admin → Platform keys rotates it at runtime).
    const fp = keyFingerprint(key);
    if (client?.fp !== fp) client = { c: new Anthropic({ apiKey: key, timeout: 120_000, maxRetries: 2 }), fp };
    return client.c.beta.messages.create(req, opts ? { timeout: opts.timeoutMs, maxRetries: opts.maxRetries } : undefined);
  },
};
