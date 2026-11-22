import { describe, expect, it } from "vitest";
import { fromOpenAiResponse, toOpenAiRequest } from "@/server/modules/agents/providers/openai";
import { fromGeminiResponse, geminiSchema, toGeminiRequest } from "@/server/modules/agents/providers/gemini";
import { providerOf } from "@/server/modules/agents/providers/catalog";
import type { ModelRequest } from "@/server/modules/agents/providers/types";
import { dueSlot } from "@/server/modules/workforce/slots";
import { buildPlan } from "@/server/modules/guide/command-plan";
import { parseUnderstanding } from "@/server/modules/guide/command-intent";
import { levelOfAutopilot, levelOfRules, levelOfEmployee } from "@/server/modules/workforce/autonomy-unified";

/** A canonical (Anthropic-shaped) request with one tool round trip: what the agent runtime sends after a tool call. */
const req = {
  model: "gpt-5",
  max_tokens: 1000,
  system: [{ type: "text", text: "You are the CFO.", cache_control: { type: "ephemeral" } }],
  tools: [{ name: "read_financial_summary", description: "Finance summary", input_schema: { type: "object", properties: { range: { type: ["string", "null"], enum: ["month", "quarter", null] } }, required: [], additionalProperties: false } }],
  messages: [
    { role: "user", content: "Task: monthly pack" },
    { role: "assistant", content: [{ type: "text", text: "Looking up" }, { type: "tool_use", id: "call_1", name: "read_financial_summary", input: { range: "month" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "Revenue 100" }, { type: "text", text: "Approval outcomes: none" }] },
  ],
} as unknown as ModelRequest;

describe("G1 provider adapters (B13)", () => {
  it("routes model ids to providers", () => {
    expect(providerOf("claude-opus-5-5")).toBe("anthropic");
    expect(providerOf("gpt-5-mini")).toBe("openai");
    expect(providerOf("o3")).toBe("openai");
    expect(providerOf("gemini-2.5-pro")).toBe("gemini");
    expect(providerOf(null)).toBe("anthropic");
  });

  it("OpenAI: tool_use ↔ tool_calls, tool_result ↔ role tool, usage with cache reads", () => {
    const o = toOpenAiRequest(req);
    expect(o.messages[0]).toEqual({ role: "system", content: "You are the CFO." });
    expect(o.messages[2]).toMatchObject({ role: "assistant", content: "Looking up", tool_calls: [{ id: "call_1", type: "function", function: { name: "read_financial_summary", arguments: '{"range":"month"}' } }] });
    expect(o.messages[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: "Revenue 100" });
    expect(o.messages[4]).toEqual({ role: "user", content: "Approval outcomes: none" });
    expect(o.tools?.[0]).toMatchObject({ type: "function", function: { name: "read_financial_summary" } });
    const m = fromOpenAiResponse("gpt-5", { model: "gpt-5-2025", choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "c2", function: { name: "read_invoices", arguments: '{"status":"open"}' } }] } }], usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 } } });
    expect(m.stop_reason).toBe("tool_use");
    expect(m.content).toEqual([{ type: "tool_use", id: "c2", name: "read_invoices", input: { status: "open" } }]);
    expect(m.usage).toMatchObject({ input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 20 });
    expect(fromOpenAiResponse("gpt-5", { choices: [{ finish_reason: "stop", message: { content: "Done" } }] }).stop_reason).toBe("end_turn");
    expect(fromOpenAiResponse("gpt-5", { choices: [{ finish_reason: "stop", message: { content: null, refusal: "no" } }] }).stop_reason).toBe("refusal");
    expect(fromOpenAiResponse("gpt-5", { choices: [{ finish_reason: "length", message: { content: "x" } }] }).stop_reason).toBe("max_tokens");
  });

  it("Gemini: functionCall / functionResponse matched by name, schema subset, usage", () => {
    const g = toGeminiRequest({ ...req, model: "gemini-2.5-pro" } as ModelRequest);
    expect(g.systemInstruction).toEqual({ parts: [{ text: "You are the CFO." }] });
    expect(g.contents[1]).toEqual({ role: "model", parts: [{ text: "Looking up" }, { functionCall: { name: "read_financial_summary", args: { range: "month" } } }] });
    expect(g.contents[2]).toEqual({ role: "user", parts: [{ functionResponse: { name: "read_financial_summary", response: { result: "Revenue 100" } } }, { text: "Approval outcomes: none" }] });
    expect(geminiSchema({ type: "object", properties: { a: { type: ["string", "null"] } }, additionalProperties: false })).toEqual({ type: "object", properties: { a: { type: "string", nullable: true } } });
    const m = fromGeminiResponse("gemini-2.5-pro", { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Hi" }, { functionCall: { name: "read_invoices", args: {} } }] } }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 5, cachedContentTokenCount: 10 } });
    expect(m.stop_reason).toBe("tool_use");
    expect(m.content[0]).toMatchObject({ type: "text", text: "Hi" });
    expect(m.content[1]).toMatchObject({ type: "tool_use", name: "read_invoices" });
    expect(m.usage).toMatchObject({ input_tokens: 40, output_tokens: 5, cache_read_input_tokens: 10 });
    expect(fromGeminiResponse("gemini-2.5-pro", { candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }).stop_reason).toBe("refusal");
  });
});

describe("G1 monthly schedules (B18)", () => {
  const spec = { frequency: "MONTHLY" as const, timeOfDay: "08:00", weekday: null, dayOfMonth: 31 };
  it("one slot per month, from the chosen day (clamped to the month's end) and time on", () => {
    expect(dueSlot(spec, new Date("2026-02-27T12:00:00Z"), "UTC")).toBeNull();
    expect(dueSlot(spec, new Date("2026-02-28T07:59:00Z"), "UTC")).toBeNull();
    expect(dueSlot(spec, new Date("2026-02-28T08:00:00Z"), "UTC")).toBe("M2026-02");
    expect(dueSlot({ ...spec, dayOfMonth: 1 }, new Date("2026-03-15T00:00:00Z"), "UTC")).toBe("M2026-03");
  });
});

describe("G1 command understanding (B26)", () => {
  it("parses the classifier JSON, keeps known departments, drops unknown and self dependencies", () => {
    const u = parseUnderstanding(JSON.stringify({ departments: [{ key: "marketing", needs: [] }, { key: "content", needs: ["marketing", "content", "nonsense"] }, { key: "bogus", needs: [] }], research: true }));
    expect(u?.intents.map((i) => i.key)).toEqual(["marketing", "content"]);
    expect(u?.dependsOn).toEqual({ content: ["marketing"] });
    expect(u?.research).toBe(true);
    expect(parseUnderstanding("not json")).toBeNull();
    expect(parseUnderstanding(JSON.stringify({ departments: [], research: false }))).toBeNull();
  });

  it("plans department dependencies acyclically (a needed step runs first)", () => {
    const intents = [{ key: "content", profile: "content_writer", score: 2 }, { key: "marketing", profile: "cmo", score: 1 }];
    const plan = buildPlan("write a blog", intents, { research: false, dependsOn: { content: ["marketing"], marketing: ["content"] } });
    const dept = plan.steps.filter((s) => s.kind === "DEPARTMENT");
    expect(dept.map((s) => s.intent)).toEqual(["content", "marketing"]);
    // The cycle is broken: the later step may depend on the earlier one, never the reverse.
    for (const s of plan.steps) for (const d of s.dependsOn) expect(d).toBeLessThan(s.position);
    const linear = buildPlan("write a blog", intents, { research: false, dependsOn: { content: ["marketing"] } });
    const [first, second] = linear.steps.filter((s) => s.kind === "DEPARTMENT");
    expect([first!.intent, second!.intent]).toEqual(["marketing", "content"]);
    expect(second!.dependsOn).toContain(first!.position);
    expect(linear.steps.at(-1)?.kind).toBe("REVIEW");
  });
});

describe("G1 one autonomy model (B23)", () => {
  it("maps each setting to Manual · Assisted · Approval · Autonomous", () => {
    expect(levelOfAutopilot("OFF")).toBe("PAUSED");
    expect(levelOfAutopilot("APPROVAL_REQUIRED")).toBe("APPROVAL");
    expect(levelOfRules(["ASK", "AUTO"], false)).toBe("APPROVAL");
    expect(levelOfRules(["ASK", "AUTO"], true)).toBe("AUTONOMOUS");
    expect(levelOfRules(["SUGGEST", "OFF"], true)).toBe("ASSISTED");
    expect(levelOfRules(["OFF"], true)).toBe("MANUAL");
    expect(levelOfEmployee("PREPARE")).toBe("ASSISTED");
    expect(levelOfEmployee("AUTONOMOUS_LOW_RISK")).toBe("AUTONOMOUS");
  });
});

describe("G1 tool precheck hook (for G2)", () => {
  it("refuses an invalid proposal before anything is filed", async () => {
    const { runPrecheck, ToolDenied } = await import("@/server/modules/tools/gateway");
    const x = { ctx: {} as never, organizationId: "o", companyId: "c" };
    const tool = { name: "schedule_social_post", precheck: (i: { media?: string }) => (i.media ? null : "Instagram posts need an image or video") } as never;
    await expect(runPrecheck(tool, {}, x)).rejects.toBeInstanceOf(ToolDenied);
    await expect(runPrecheck(tool, {}, x)).rejects.toThrow("Not filed: Instagram posts need an image or video");
    await expect(runPrecheck(tool, { media: "a.png" }, x)).resolves.toBeUndefined();
    await expect(runPrecheck({ name: "x" } as never, {}, x)).resolves.toBeUndefined();
  });
});
