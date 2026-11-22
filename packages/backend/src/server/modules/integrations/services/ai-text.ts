import "server-only";
import { providerFetch } from "../client";
import { compatibleBase } from "../providers";
import { estimateTokenCostMicros, recordUsage } from "../usage";
import { ensureOk, errorText, spendBlocked, str, withFallback, type ServiceResult } from "./common";

/**
 * Quick text generation for module features (rewrites, summaries, translations) with provider fallback
 * OpenAI → Gemini → OpenRouter → any OpenAI-compatible endpoint. Anthropic stays the agent runtime (src/server/modules/agents); this never replaces it.
 */

export const AI_TEXT_PROVIDERS = ["openai", "gemini", "openrouter", "openai_compatible"] as const;
type AiTextProvider = (typeof AI_TEXT_PROVIDERS)[number];
const DEFAULT_MODEL: Record<AiTextProvider, string> = { openai: "gpt-4.1-mini", gemini: "gemini-2.5-flash", openrouter: "openai/gpt-4.1-mini", openai_compatible: "" };
const MODEL_RE = /^[A-Za-z0-9.:_/-]{2,100}$/;

export interface GenerateTextInput {
  system?: string;
  prompt: string;
  /** Model override; applies to the provider it belongs to (gemini models go to Gemini, others to OpenAI). */
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  providers?: readonly (typeof AI_TEXT_PROVIDERS)[number][];
}

export interface GeneratedText {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number | null;
}

const modelFor = (provider: AiTextProvider, input: GenerateTextInput, config: Record<string, unknown>) => {
  const m = input.model?.trim();
  // A model override applies to the provider it belongs to: gemini-* → Gemini, vendor/model → OpenRouter, others → OpenAI.
  const belongs = m && MODEL_RE.test(m) && (provider === "gemini" ? m.startsWith("gemini") : provider === "openrouter" ? m.includes("/") : provider === "openai" ? !m.startsWith("gemini") && !m.includes("/") : false);
  if (m && belongs) return m;
  const configured = str(config.model);
  return configured && MODEL_RE.test(configured) ? configured : DEFAULT_MODEL[provider];
};

export async function generateText(organizationId: string, companyId: string, input: GenerateTextInput): Promise<ServiceResult<GeneratedText>> {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, code: "invalid_input", error: "Prompt is empty", providerId: null, attempts: [] };
  if (prompt.length > 100_000) return { ok: false, code: "invalid_input", error: "Prompt is too long", providerId: null, attempts: [] };
  const maxTokens = Math.min(Math.max(16, Math.floor(input.maxOutputTokens ?? 1024)), 8192);
  const temperature = input.temperature === undefined ? undefined : Math.min(Math.max(0, input.temperature), 2);

  const blocked = await spendBlocked(organizationId, companyId);
  if (blocked) return blocked;

  return withFallback(organizationId, companyId, input.providers ?? AI_TEXT_PROVIDERS, async (conn) => {
    const provider = conn.provider as AiTextProvider;
    const model = modelFor(provider, input, conn.config);
    try {
      let out: Omit<GeneratedText, "estimatedCostMicros">;
      let reportedCostMicros: number | null = null;
      if (provider !== "gemini") {
        if (!model) throw new Error(`${provider} has no model configured`);
        const base = compatibleBase(provider, conn.config);
        if (!base) throw new Error(`${provider} has no base URL configured`);
        const messages = [...(input.system ? [{ role: "system", content: input.system }] : []), { role: "user", content: prompt }];
        // OpenAI uses max_completion_tokens; most OpenAI-compatible servers (and OpenRouter) still read max_tokens.
        const limits = provider === "openai" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
        const res = await providerFetch<{ choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; model?: string }>(
          conn,
          `${base}/chat/completions`,
          { json: { model, messages, ...limits, ...(temperature !== undefined ? { temperature } : {}), ...(provider === "openrouter" ? { usage: { include: true } } : {}) }, timeoutMs: 60_000, retries: 2 },
        );
        ensureOk(res, `${provider} chat completion`);
        const text = res.data?.choices?.[0]?.message?.content ?? "";
        out = { text, model: res.data?.model ?? model, inputTokens: res.data?.usage?.prompt_tokens ?? 0, outputTokens: res.data?.usage?.completion_tokens ?? 0 };
        // OpenRouter reports the real charge (USD) of the request.
        if (typeof res.data?.usage?.cost === "number") reportedCostMicros = Math.round(res.data.usage.cost * 1_000_000);
      } else {
        const res = await providerFetch<{ candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }; modelVersion?: string }>(
          conn,
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            json: {
              ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: maxTokens, ...(temperature !== undefined ? { temperature } : {}) },
            },
            timeoutMs: 60_000,
            retries: 2,
          },
        );
        ensureOk(res, "Gemini generateContent");
        const text = (res.data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
        out = { text, model: res.data?.modelVersion ?? model, inputTokens: res.data?.usageMetadata?.promptTokenCount ?? 0, outputTokens: res.data?.usageMetadata?.candidatesTokenCount ?? 0 };
      }
      if (!out.text.trim()) throw new Error(`${provider} returned no text`);
      const cost = reportedCostMicros ?? estimateTokenCostMicros(out.model.replace(/^openai\//, ""), out.inputTokens, out.outputTokens);
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "ai.text", units: out.inputTokens + out.outputTokens, unit: "token", estimatedCostMicros: cost, status: "SUCCEEDED", meta: { model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens } });
      return { ...out, estimatedCostMicros: cost };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "ai.text", units: 0, unit: "token", estimatedCostMicros: 0, status: "FAILED", error: errorText(err), meta: { model } });
      throw err;
    }
  });
}
