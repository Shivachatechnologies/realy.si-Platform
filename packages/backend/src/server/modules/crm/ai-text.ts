import { logger } from "@/server/core/logger";
import { aiConfigured, quickModelCall, TaskError } from "@/server/modules/agents/runtime";
import { generateText } from "@/server/modules/integrations/services/ai-text";
import { aiPaused } from "./channels";

/**
 * One short AI text call of the revenue engine (first emails, drafts, reply classification). It goes through the shared
 * runtime (quickModelCall: model router tier, fallback chain and breaker, platform AI budget, hard-stop cost budgets
 * and the cost ledger). Only when that runtime has no model configured does it use the connected AI text providers
 * (OpenAI / Gemini). A refusal by a budget or a kill switch is final: it never falls back to another provider.
 */

export type CrmTextFailure = "paused" | "not_configured" | "budget" | "failed";
export type CrmTextResult = { ok: true; text: string; via: string } | { ok: false; code: CrmTextFailure; error: string };

export interface CrmTextInput {
  /** Routing / platform-control profile (an AI employee profile key, e.g. "sdr"). */
  profileKey: string;
  system: string;
  prompt: string;
  maxTokens: number;
  /** Structured output schema (shared runtime only; the fallback providers are asked for JSON in the prompt). */
  jsonSchema?: Record<string, unknown>;
  operation: string;
  sourceType: string;
  sourceId: string;
  tier?: "simple" | "standard";
  temperature?: number;
  timeoutMs?: number;
}

const BUDGET_CODES = new Set(["cost_budget_reached", "platform_ai_budget_exhausted", "plan_ai_tokens_exhausted"]);

export async function crmModelText(organizationId: string, companyId: string, input: CrmTextInput): Promise<CrmTextResult> {
  if (await aiPaused(organizationId, companyId)) return { ok: false, code: "paused", error: "AI is paused" };
  if (aiConfigured()) {
    try {
      const r = await quickModelCall({
        organizationId,
        companyId,
        profileKey: input.profileKey,
        tier: input.tier ?? "simple",
        system: input.system,
        messages: [{ role: "user", content: input.prompt }],
        maxTokens: input.maxTokens,
        ...(input.jsonSchema ? { jsonSchema: input.jsonSchema } : {}),
        operation: input.operation,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        department: "sales",
        timeoutMs: input.timeoutMs ?? 20_000,
      });
      return { ok: true, text: r.text, via: `realy:${r.model}`.slice(0, 80) };
    } catch (err) {
      const code = err instanceof TaskError ? err.code : "provider_error";
      const message = err instanceof Error ? err.message : String(err);
      if (code !== "ai_not_configured") {
        logger.info({ code, operation: input.operation }, "crm AI call refused or failed");
        return { ok: false, code: BUDGET_CODES.has(code) ? "budget" : "failed", error: message.slice(0, 300) };
      }
    }
  }
  const ai = await generateText(organizationId, companyId, { system: input.system, prompt: input.prompt, maxOutputTokens: input.maxTokens, temperature: input.temperature });
  if (ai.ok) return { ok: true, text: ai.data.text, via: `${ai.providerId}:${ai.data.model}`.slice(0, 80) };
  if (ai.code === "not_connected") return { ok: false, code: "not_configured", error: "No AI model is configured" };
  return { ok: false, code: "failed", error: ai.error.slice(0, 300) };
}

/** The first JSON object in a model answer (models sometimes wrap it in prose or a code fence). */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
