import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { env } from "@/server/core/env";
import { keyFingerprint } from "@/server/core/platform-secrets";
import { platformBudgetRefusal, providerOf, resolvePlatformModel } from "@/server/modules/admin/ai-models";
import { breakerAllows, breakerFailure, breakerSuccess, fallbackChain, modelForTier, type ComplexityTier } from "@/server/modules/agents/router";
import { estimateTokens } from "@/server/modules/agents/context";
import { aiConfigured, quickModelCall, TaskError, type QuickCallResult } from "@/server/modules/agents/runtime";
import { checkSpend, recordCost } from "@/server/modules/costs/service";
import { tokenCostMicros } from "@/server/modules/costs/prices";

/**
 * Streaming variant of the runtime's quickModelCall for the Voice OS answer path: the same router tier, admin fallback
 * chain and circuit breaker, platform AI budget and hard-stop cost budget before the call, and the cost ledger after
 * it — but the reply arrives token by token (`onText`), so the console can speak the first sentence while the rest is
 * still being written. A model is switched only before any text was produced (never mixed answers). Without the
 * platform Anthropic key (e.g. the scripted test model) it falls back to one non-streaming quickModelCall and hands
 * over the whole text at once — never a simulated stream.
 */

export interface StreamCallInput {
  organizationId: string;
  companyId: string;
  profileKey: string;
  tier: ComplexityTier;
  system: string;
  messages: BetaMessageParam[];
  maxTokens: number;
  operation: string;
  sourceType: string;
  sourceId: string;
  department?: string | null;
  timeoutMs?: number;
  onText: (delta: string) => void;
}

type StreamFn = (params: { model: string; max_tokens: number; system: string; messages: BetaMessageParam[] }, onText: (t: string) => void, timeoutMs: number) => Promise<BetaMessage>;

let client: { c: Anthropic; fp: string } | null = null;
let testStream: StreamFn | null = null;

/** Test seam: a scripted streaming model. Never set outside tests. */
export function setStreamModelForTests(fn: StreamFn | null) {
  testStream = fn;
}

const MAX_ATTEMPTS = 3;

const anthropicStream: StreamFn = async (params, onText, timeoutMs) => {
  const key = env().ANTHROPIC_API_KEY!;
  const fp = keyFingerprint(key);
  if (client?.fp !== fp) client = { c: new Anthropic({ apiKey: key, timeout: 120_000, maxRetries: 1 }), fp };
  const stream = client.c.beta.messages.stream(params, { timeout: timeoutMs, maxRetries: 1 });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") onText(event.delta.text);
  }
  return stream.finalMessage();
};

function mapError(err: unknown): TaskError & { fallbackEligible?: boolean } {
  if (err instanceof TaskError) return err;
  let e: TaskError;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) e = new TaskError("provider_auth", "The AI provider rejected the configured credentials");
  else if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) e = new TaskError("provider_unavailable", "The AI provider is temporarily unavailable", true);
  else if (err instanceof Anthropic.BadRequestError) e = new TaskError("provider_rejected", "The AI provider rejected the request");
  else e = new TaskError("provider_error", "The AI provider call failed", true);
  const unavailable = err instanceof Anthropic.NotFoundError || (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503));
  e.fallbackEligible = unavailable || e.code === "provider_unavailable" || e.code === "provider_error";
  return e;
}

/** True when this deployment can stream (platform key present or a scripted stream in tests). */
export const streamingAvailable = () => !!testStream || !!env().ANTHROPIC_API_KEY;

export async function streamModelCall(input: StreamCallInput): Promise<QuickCallResult> {
  if (!aiConfigured()) throw new TaskError("ai_not_configured", "AI is not configured on this platform");
  if (!streamingAvailable()) {
    const r = await quickModelCall(input);
    input.onText(r.text);
    return r;
  }
  const budget = await platformBudgetRefusal();
  if (budget) throw new TaskError(budget, "The platform's monthly AI budget is used up; retry later");
  const { organizationId, companyId } = input;
  let model: string;
  try {
    model = (await modelForTier(organizationId, input.profileKey, input.tier)) ?? (await resolvePlatformModel({ organizationId, profile: input.profileKey }));
  } catch {
    model = await resolvePlatformModel({ organizationId, profile: input.profileKey });
  }
  const department = input.department ?? null;
  const estimate = await tokenCostMicros(model, { inputTokens: estimateTokens(input.system + JSON.stringify(input.messages)), outputTokens: input.maxTokens });
  const spend = await checkSpend({ organizationId, companyId, department }, estimate);
  if (!spend.ok) throw new TaskError("cost_budget_reached", `${spend.message}, so nothing was spent. Raise the budget in Costs or retry next period.`);

  const run = testStream ?? anthropicStream;
  const chain = [model, ...(await fallbackChain(organizationId, input.profileKey, model, input.tier).catch(() => [] as string[]))];
  let response: BetaMessage | null = null;
  let lastErr: unknown = null;
  for (const m of chain.slice(0, MAX_ATTEMPTS)) {
    if (!breakerAllows(m)) continue;
    let emitted = false;
    try {
      response = await run({ model: m, max_tokens: input.maxTokens, system: input.system, messages: input.messages }, (t) => {
        emitted = true;
        input.onText(t);
      }, input.timeoutMs ?? 20_000);
      breakerSuccess(m);
      model = m;
      break;
    } catch (err) {
      lastErr = err;
      const mapped = mapError(err);
      breakerFailure(m);
      // Part of an answer was already handed out: another model would start a different one.
      if (emitted || !mapped.fallbackEligible) throw mapped;
    }
  }
  if (!response) {
    if (lastErr === null) throw new TaskError("provider_unavailable", "Every AI model is temporarily paused after repeated provider errors; retry shortly", true);
    throw mapError(lastErr);
  }
  const u = response.usage;
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const servedBy = response.model || model;
  const costMicros = await tokenCostMicros(servedBy, { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: read, cacheWriteTokens: write });
  await recordCost({
    organizationId,
    companyId,
    category: "AI_TOKENS",
    provider: providerOf(servedBy),
    model: servedBy,
    operation: input.operation,
    department,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cachedTokens: read,
    cacheWriteTokens: write,
    units: u.input_tokens + read + write + u.output_tokens,
    unit: "token",
    costMicros,
    meta: { tier: input.tier, profile: input.profileKey, streamed: true },
  });
  const inputTokens = u.input_tokens + read + write;
  if (response.stop_reason === "refusal") throw Object.assign(new TaskError("refused", "The AI declined this request"), { usage: { model: servedBy, inputTokens, outputTokens: u.output_tokens } });
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim();
  if (!text) throw Object.assign(new TaskError("empty_output", "The AI returned no reply"), { usage: { model: servedBy, inputTokens, outputTokens: u.output_tokens } });
  return { text, model: servedBy, inputTokens, outputTokens: u.output_tokens, costMicros };
}
