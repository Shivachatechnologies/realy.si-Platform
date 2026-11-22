import { env } from "@/server/core/env";
import { AI_PROVIDERS, providerKeyConfigured } from "@/server/modules/agents/providers/catalog";

/**
 * Models an AI employee may be configured to run on: the platform default (AGENT_MODEL) plus the comma-separated
 * AGENT_ALLOWED_MODELS platform setting (environment), plus the default models of every other provider whose platform
 * key is set (OpenAI, Gemini — agents/providers). Only these ids are accepted and used at run time.
 */
export function allowedModels(): string[] {
  const extra = (process.env.AGENT_ALLOWED_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9.-]{3,64}$/.test(s));
  const providers = AI_PROVIDERS.filter((p) => p.key !== "anthropic" && providerKeyConfigured(p.key)).flatMap((p) => Object.values(p.fallbackModels));
  return [...new Set([env().AGENT_MODEL, ...extra, ...providers])];
}

export const defaultModel = () => env().AGENT_MODEL;

/** The model a run uses: the employee's configured model while it is still allowed, else the platform default. */
export const effectiveModel = (configured: string | null | undefined) => (configured && allowedModels().includes(configured) ? configured : defaultModel());
