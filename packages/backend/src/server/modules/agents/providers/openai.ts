import { randomUUID } from "node:crypto";
import { providerKeyConfigured } from "./catalog";
import { blocksOf, canonicalMessage, outputSchemaOf, postJson, ProviderNotConfigured, systemText, toolResultText, toolsOf, type CallOptions, type ModelProvider, type ModelRequest, type ModelResponse } from "./types";

/**
 * OpenAI adapter (Chat Completions with function calling). Canonical tool_use ↔ assistant tool_calls,
 * tool_result ↔ role "tool" messages; prompt-cache hits are reported as cache reads. Uses the platform key
 * OPENAI_API_KEY (Admin → Platform keys).
 */

const URL = "https://api.openai.com/v1/chat/completions";

type OaiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export function toOpenAiRequest(req: ModelRequest) {
  const messages: OaiMessage[] = [];
  const system = systemText(req.system);
  const schema = outputSchemaOf(req);
  if (system) messages.push({ role: "system", content: system });
  for (const m of req.messages) {
    const blocks = blocksOf(m.content);
    if (m.role === "assistant") {
      const text = blocks.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("");
      const calls = blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: String(b.id), type: "function" as const, function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) } }));
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // Tool results first (they answer the previous assistant turn), then any text the runtime appended.
    for (const b of blocks.filter((x) => x.type === "tool_result")) messages.push({ role: "tool", tool_call_id: String(b.tool_use_id), content: (b.is_error ? "Error: " : "") + toolResultText(b.content) });
    const text = blocks.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n");
    if (text) messages.push({ role: "user", content: text });
  }
  const tools = toolsOf(req).map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.schema } }));
  return {
    model: req.model,
    messages,
    max_completion_tokens: req.max_tokens,
    ...(tools.length ? { tools } : {}),
    ...(schema ? { response_format: { type: "json_schema", json_schema: { name: "output", schema, strict: false } } } : {}),
  };
}

interface OaiResponse {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

export function fromOpenAiResponse(model: string, r: OaiResponse): ModelResponse {
  const choice = r.choices?.[0];
  const msg = choice?.message;
  const content: { type: string; [k: string]: unknown }[] = [];
  if (msg?.content) content.push({ type: "text", text: msg.content, citations: null });
  for (const c of msg?.tool_calls ?? []) {
    let input: unknown = {};
    try {
      input = c.function?.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      input = {}; // the gateway's schema check reports the malformed call to the model
    }
    content.push({ type: "tool_use", id: c.id || `call_${randomUUID().slice(0, 8)}`, name: c.function?.name ?? "", input });
  }
  const finish = choice?.finish_reason;
  const stop = msg?.refusal ? "refusal" : finish === "tool_calls" || (msg?.tool_calls?.length ?? 0) > 0 ? "tool_use" : finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : "end_turn";
  const prompt = r.usage?.prompt_tokens ?? 0;
  const cached = Math.min(r.usage?.prompt_tokens_details?.cached_tokens ?? 0, prompt);
  return canonicalMessage(r.model ?? model, content, stop, { input: prompt - cached, output: r.usage?.completion_tokens ?? 0, cacheRead: cached });
}

export const openAiProvider: ModelProvider = {
  key: "openai",
  configured: () => providerKeyConfigured("openai"),
  async call(req: ModelRequest, opts?: CallOptions) {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new ProviderNotConfigured("openai");
    const org = process.env.OPENAI_ORGANIZATION?.trim();
    const r = await postJson<OaiResponse>("openai", URL, { authorization: `Bearer ${key}`, ...(org ? { "openai-organization": org } : {}) }, toOpenAiRequest(req), opts);
    return fromOpenAiResponse(req.model, r);
  },
};
