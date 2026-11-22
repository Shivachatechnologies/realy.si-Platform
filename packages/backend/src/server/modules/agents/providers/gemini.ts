import { randomUUID } from "node:crypto";
import { providerKeyConfigured } from "./catalog";
import { blocksOf, canonicalMessage, outputSchemaOf, postJson, ProviderNotConfigured, systemText, toolResultText, toolsOf, type CallOptions, type ModelProvider, type ModelRequest, type ModelResponse } from "./types";

/**
 * Google Gemini adapter (generateContent with function declarations). Canonical tool_use ↔ functionCall parts,
 * tool_result ↔ functionResponse parts (matched to the call's name), JSON-schema subset translated for Gemini.
 * Uses the platform key GEMINI_API_KEY (Admin → Platform keys).
 */

const base = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
const KEEP = new Set(["type", "format", "description", "nullable", "enum", "properties", "required", "items", "minItems", "maxItems", "minimum", "maximum"]);

/** Gemini accepts an OpenAPI subset: drop unsupported keywords, fold ["x","null"] types into nullable. */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (!KEEP.has(k)) continue;
    if (k === "type" && Array.isArray(v)) {
      const types = v.filter((t) => t !== "null");
      out.type = types[0] ?? "string";
      if (types.length !== v.length) out.nullable = true;
      continue;
    }
    if (k === "properties" && v && typeof v === "object") out.properties = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, geminiSchema(pv)]));
    else if (k === "items") out.items = geminiSchema(v);
    else out[k] = v;
  }
  // An object with no properties is not accepted as a function parameter schema.
  if (out.type === "object" && (!out.properties || Object.keys(out.properties as object).length === 0)) {
    delete out.properties;
    delete out.required;
  }
  return out;
}

type Part = { text?: string; functionCall?: { name: string; args: unknown }; functionResponse?: { name: string; response: unknown } };

export function toGeminiRequest(req: ModelRequest) {
  const names = new Map<string, string>(); // tool_use id → function name
  const contents: { role: "user" | "model"; parts: Part[] }[] = [];
  for (const m of req.messages) {
    const parts: Part[] = [];
    for (const b of blocksOf(m.content)) {
      if (b.type === "text" && b.text) parts.push({ text: String(b.text) });
      else if (b.type === "tool_use") {
        names.set(String(b.id), String(b.name));
        parts.push({ functionCall: { name: String(b.name), args: b.input ?? {} } });
      } else if (b.type === "tool_result") {
        const name = names.get(String(b.tool_use_id)) ?? "tool";
        parts.push({ functionResponse: { name, response: { [b.is_error ? "error" : "result"]: toolResultText(b.content) } } });
      }
    }
    if (parts.length) contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  const schema = outputSchemaOf(req);
  const system = systemText(req.system) + (schema ? `\n\nReply with JSON only, matching this JSON schema:\n${JSON.stringify(schema)}` : "");
  const decls = toolsOf(req).map((t) => {
    const parameters = geminiSchema(t.schema) as Record<string, unknown>;
    return { name: t.name, description: t.description, ...(parameters.properties ? { parameters } : {}) };
  });
  return {
    ...(system.trim() ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    ...(decls.length ? { tools: [{ functionDeclarations: decls }] } : {}),
    generationConfig: { maxOutputTokens: req.max_tokens, ...(schema ? { responseMimeType: "application/json" } : {}) },
  };
}

interface GeminiResponse {
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean; functionCall?: { id?: string; name?: string; args?: unknown } }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
}

const REFUSALS = new Set(["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"]);

export function fromGeminiResponse(model: string, r: GeminiResponse): ModelResponse {
  const cand = r.candidates?.[0];
  const content: { type: string; [k: string]: unknown }[] = [];
  const text = (cand?.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  if (text) content.push({ type: "text", text, citations: null });
  for (const p of cand?.content?.parts ?? []) {
    if (p.functionCall?.name) content.push({ type: "tool_use", id: p.functionCall.id || `call_${randomUUID().slice(0, 8)}`, name: p.functionCall.name, input: p.functionCall.args ?? {} });
  }
  const finish = cand?.finishReason ?? "";
  const stop = r.promptFeedback?.blockReason || REFUSALS.has(finish) ? "refusal" : content.some((c) => c.type === "tool_use") ? "tool_use" : finish === "MAX_TOKENS" ? "max_tokens" : "end_turn";
  const u = r.usageMetadata ?? {};
  const prompt = u.promptTokenCount ?? 0;
  const cached = Math.min(u.cachedContentTokenCount ?? 0, prompt);
  return canonicalMessage(r.modelVersion ?? model, content, stop, { input: prompt - cached, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cacheRead: cached });
}

export const geminiProvider: ModelProvider = {
  key: "gemini",
  configured: () => providerKeyConfigured("gemini"),
  async call(req: ModelRequest, opts?: CallOptions) {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new ProviderNotConfigured("gemini");
    const r = await postJson<GeminiResponse>("gemini", base(req.model), { "x-goog-api-key": key }, toGeminiRequest(req), opts);
    return fromGeminiResponse(req.model, r);
  },
};
