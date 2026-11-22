import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { db } from "@/server/core/db";
import { agentTaskQueue } from "@/server/core/jobs";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { setModelForTests } from "@/server/modules/agents/runtime";
import { startVoiceSession } from "@/server/modules/voiceos/service";
import { setStreamModelForTests } from "@/server/modules/voiceos/stream-model";
import { utteranceStream } from "@/server/modules/voiceos/stream-answer";
import { makeUser, raiseLimits, resetDb } from "../helpers";

/**
 * B28 (G5): a direct answer is streamed — routing first, then each finished sentence while the model writes, then the
 * same authoritative result as POST …/utterances; the cost ledger records the streamed call. The models are scripted
 * through the test seams (never simulated in product code).
 */

vi.mock("@/i18n/server", () => import("@/worker/i18n-server"));

const base = { id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 30 } };
const classifier = (intent: string) =>
  setModelForTests(async (p: MessageCreateParamsNonStreaming) => {
    if (p.output_config?.format) return { ...base, content: [{ type: "text", text: JSON.stringify({ intent }) }] } as unknown as BetaMessage;
    return { ...base, content: [{ type: "text", text: "Nothing is running right now. You have no pending approvals." }] } as unknown as BetaMessage;
  });

async function read(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  return text.trim().split("\n").map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
}

let s: Awaited<ReturnType<typeof setup>>;
async function setup() {
  const owner = await makeUser({ name: "Stream Founder" });
  const org = await createOrganization(owner.ctx, { name: `Stream ${Math.random()}` });
  await raiseLimits(org.id, { "companies.max": 2 });
  const company = await createCompany(owner.ctx, org.id, { name: "Streaming Co", incorporationCountryCode: "IN" });
  return { owner, org, company };
}

beforeAll(async () => {
  await resetDb();
  s = await setup();
});
afterEach(() => {
  setModelForTests(null);
  setStreamModelForTests(null);
});
afterAll(async () => {
  await agentTaskQueue().obliterate({ force: true });
});

describe("streamed voice answers", () => {
  it("streams sentences as the model writes them and ends with the authoritative result", async () => {
    classifier("company_question");
    const deltas = ["All quiet: no AI ", "tasks are running. ", "You have no pending ", "approvals right now."];
    setStreamModelForTests(async (params, onText) => {
      for (const d of deltas) onText(d);
      return { ...base, model: params.model, content: [{ type: "text", text: deltas.join("") }] } as unknown as BetaMessage;
    });
    const sid = (await startVoiceSession(s.owner.ctx, s.org.id, s.company.id, { language: "en-US" })).id;
    const events = await read(utteranceStream(s.owner.ctx, s.org.id, s.company.id, sid, { text: "how is everything?", inputMode: "voice" }));
    expect(events[0]).toMatchObject({ type: "route", intent: "company_question", language: "en-US" });
    const sentences = events.filter((e) => e.type === "sentence").map((e) => e.text);
    expect(sentences).toEqual(["All quiet: no AI tasks are running.", "You have no pending approvals right now."]);
    const result = events[events.length - 1]!;
    expect(result).toMatchObject({ type: "result", intent: "company_question", streamedSentences: 2, reply: { key: "answer", text: "All quiet: no AI tasks are running. You have no pending approvals right now." } });
    const ledger = await db().costLedgerEntry.findMany({ where: { companyId: s.company.id, operation: "voiceos.answer" } });
    expect(ledger).toHaveLength(1);
    expect((ledger[0]!.meta as { streamed?: boolean }).streamed).toBe(true);
  });

  it("falls back to the honest status reply when the AI fails mid-answer", async () => {
    classifier("company_question");
    setStreamModelForTests(async (_p, onText) => {
      onText("Revenue is ");
      throw new Error("socket hang up");
    });
    const sid = (await startVoiceSession(s.owner.ctx, s.org.id, s.company.id, { language: "en-US" })).id;
    const events = await read(utteranceStream(s.owner.ctx, s.org.id, s.company.id, sid, { text: "what is our revenue?", inputMode: "voice" }));
    const result = events[events.length - 1]!;
    expect(result.type).toBe("result");
    expect((result.reply as { key: string }).key).toBe("status");
    expect(await db().agentTask.count({ where: { companyId: s.company.id, status: "FAILED", profile: "voice_assistant" } })).toBeGreaterThanOrEqual(1);
  });

  it("routes work requests to AI Command without streaming an answer", async () => {
    classifier("work_request");
    const sid = (await startVoiceSession(s.owner.ctx, s.org.id, s.company.id, { language: "en-US" })).id;
    const events = await read(utteranceStream(s.owner.ctx, s.org.id, s.company.id, sid, { text: "write a LinkedIn post about our launch", inputMode: "voice" }));
    expect(events.map((e) => e.type)).toEqual(["route", "result"]);
    expect(events[1]).toMatchObject({ intent: "work_request" });
  });
});
