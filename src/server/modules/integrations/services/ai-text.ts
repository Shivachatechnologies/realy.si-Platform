import "server-only";
import { providerFetch } from "../client";
import { estimateTokenCostMicros, recordUsage } from "../usage";
import { ensureOk, errorText, str, withFallback, type ServiceResult } from "./common";

/**
 * Quick text generation for module features (rewrites, summaries, translations) with provider fallback
 * OpenAI → Gemini. Anthropic stays the agent runtime (src/server/modules/agents); this never replaces it.
 */

export const AI_TEXT_PROVIDERS = ["openai", "gemini"] as const;
const DEFAULT_MODEL = { openai: "gpt-4.1-mini", gemini: "gemini-2.5-flash" } as const;

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

const modelFor = (provider: "openai" | "gemini", input: GenerateTextInput, config: Record<string, unknown>) => {
  const m = input.model?.trim();
  if (m && /^[A-Za-z0-9.:_-]{2,64}$/.test(m) && (provider === "gemini" ? m.startsWith("gemini") : !m.startsWith("gemini"))) return m;
  const configured = str(config.model);
  return configured && /^[A-Za-z0-9.:_-]{2,64}$/.test(configured) ? configured : DEFAULT_MODEL[provider];
};

export async function generateText(organizationId: string, companyId: string, input: GenerateTextInput): Promise<ServiceResult<GeneratedText>> {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, code: "invalid_input", error: "Prompt is empty", providerId: null, attempts: [] };
  if (prompt.length > 100_000) return { ok: false, code: "invalid_input", error: "Prompt is too long", providerId: null, attempts: [] };
  const maxTokens = Math.min(Math.max(16, Math.floor(input.maxOutputTokens ?? 1024)), 8192);
  const temperature = input.temperature === undefined ? undefined : Math.min(Math.max(0, input.temperature), 2);

  return withFallback(organizationId, companyId, input.providers ?? AI_TEXT_PROVIDERS, async (conn) => {
    const provider = conn.provider as "openai" | "gemini";
    const model = modelFor(provider, input, conn.config);
    try {
      let out: Omit<GeneratedText, "estimatedCostMicros">;
      if (provider === "openai") {
        const messages = [...(input.system ? [{ role: "system", content: input.system }] : []), { role: "user", content: prompt }];
        const res = await providerFetch<{ choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string }>(
          conn,
          "https://api.openai.com/v1/chat/completions",
          { json: { model, messages, max_completion_tokens: maxTokens, ...(temperature !== undefined ? { temperature } : {}) }, timeoutMs: 60_000, retries: 2 },
        );
        ensureOk(res, "OpenAI chat completion");
        const text = res.data?.choices?.[0]?.message?.content ?? "";
        out = { text, model: res.data?.model ?? model, inputTokens: res.data?.usage?.prompt_tokens ?? 0, outputTokens: res.data?.usage?.completion_tokens ?? 0 };
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
      const cost = estimateTokenCostMicros(out.model, out.inputTokens, out.outputTokens);
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "ai.text", units: out.inputTokens + out.outputTokens, unit: "token", estimatedCostMicros: cost, status: "SUCCEEDED", meta: { model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens } });
      return { ...out, estimatedCostMicros: cost };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "ai.text", units: 0, unit: "token", estimatedCostMicros: 0, status: "FAILED", error: errorText(err), meta: { model } });
      throw err;
    }
  });
}
