import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { db } from "@/server/core/db";
import { agentTaskQueue } from "@/server/core/jobs";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { setModelForTests } from "@/server/modules/agents/runtime";
import { startVoiceSession, utter } from "@/server/modules/voiceos/service";
import { makeUser, raiseLimits, resetDb } from "../helpers";

/**
 * Voice OS routing end to end against the database: questions are answered in the request from live data, small talk
 * is answered, work is dispatched to AI Command with an honest reply about the background worker, and AI failures are
 * recorded as failed voice_assistant tasks (Admin → AI errors). The model is scripted (test seam), never simulated in code.
 */

// AI Command reads `[locale]` through the app's @/i18n/server (next/root-params); outside Next use the worker's copy.
vi.mock("@/i18n/server", () => import("@/worker/i18n-server"));

type Call = MessageCreateParamsNonStreaming;
const calls: Call[] = [];

function scripted(opts: { intent: string; answer?: string | Error }) {
  calls.length = 0;
  setModelForTests(async (p) => {
    calls.push(structuredClone(p));
    const classify = !!p.output_config?.format;
    const base = { id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 120, output_tokens: 20 } };
    if (classify) return { ...base, content: [{ type: "text", text: JSON.stringify({ intent: opts.intent }) }] } as unknown as BetaMessage;
    if (opts.answer instanceof Error) throw opts.answer;
    // Department steps of a dispatched command (AI employee tasks) never run here: no worker in tests.
    return { ...base, content: [{ type: "text", text: opts.answer ?? "OK" }] } as unknown as BetaMessage;
  });
}

const systemOf = (c: Call) => (typeof c.system === "string" ? c.system : (c.system ?? []).map((b) => b.text).join("\n"));

let setup: Awaited<ReturnType<typeof makeSetup>>;
async function makeSetup() {
  const owner = await makeUser({ name: "Asha Founder" });
  const org = await createOrganization(owner.ctx, { name: `Voice ${Math.random()}` });
  await raiseLimits(org.id, { "companies.max": 2 });
  const company = await createCompany(owner.ctx, org.id, { name: "Chai Robotics", incorporationCountryCode: "IN" });
  return { owner, org, company };
}

beforeAll(async () => {
  await resetDb();
  setup = await makeSetup();
});
beforeEach(async () => {
  await db().platformHeartbeat.deleteMany({ where: { kind: "worker" } });
});
afterEach(() => setModelForTests(null));
afterAll(async () => {
  await db().platformHeartbeat.deleteMany({ where: { kind: "worker" } });
  await agentTaskQueue().obliterate({ force: true });
});

async function session() {
  const s = await startVoiceSession(setup.owner.ctx, setup.org.id, setup.company.id, { language: "en-US" });
  return s.id;
}

describe("Voice OS conversation routing", () => {
  it("answers 'sab kaisa hai?' directly, in Hinglish, grounded in live data (no AI Command run)", async () => {
    scripted({ intent: "company_question", answer: "Sab theek hai! Abhi koi AI task nahi chal raha aur koi approval pending nahi hai." });
    const sid = await session();
    const before = await db().commandRun.count({ where: { companyId: setup.company.id } });
    const out = await utter(setup.owner.ctx, setup.org.id, setup.company.id, sid, { text: "hey Realy, sab kaisa hai?", inputMode: "voice" });
    expect(out.intent).toBe("company_question");
    expect(out.routedBy).toBe("model");
    expect(out.run).toBeNull();
    expect(out.reply.key).toBe("answer");
    expect(out.reply.text).toContain("Sab theek hai");
    expect(out.reply.language).toBe("hi-IN");
    expect(await db().commandRun.count({ where: { companyId: setup.company.id } })).toBe(before);
    // One classifier call (fast tier, structured output) and one grounded answer call.
    expect(calls).toHaveLength(2);
    expect(calls[0]!.model).toBe("claude-haiku-5-5");
    expect(calls[0]!.output_config?.format?.type).toBe("json_schema");
    const sys = systemOf(calls[1]!);
    expect(sys).toContain("Hinglish");
    expect(sys).toContain("Company: Chai Robotics");
    expect(sys).toContain("AI employee tasks: 0 running, 0 queued");
    expect(sys).toContain("Pending approvals: 0");
    expect(sys).toMatch(/Background worker that executes AI tasks: NOT RUNNING/);
    // Cost ledger and plan credits recorded like other AI calls; usage row is excluded from the company's task counts.
    const ledger = await db().costLedgerEntry.findMany({ where: { companyId: setup.company.id, operation: { in: ["voiceos.intent", "voiceos.answer"] } } });
    expect(ledger.map((l) => l.operation).sort()).toEqual(["voiceos.answer", "voiceos.intent"]);
    const usage = await db().agentTask.findFirst({ where: { companyId: setup.company.id, profile: "voice_assistant", status: "COMPLETED", subjectId: sid } });
    expect(usage?.inputTokens).toBe(240);
  });

  it("answers 'kitne approvals pending hain?' with the real count", async () => {
    const t = await db().agentTask.create({
      data: { organizationId: setup.org.id, companyId: setup.company.id, profile: "cfo", title: "Invoice run", instructions: "x", status: "COMPLETED", output: "done", createdById: setup.owner.user.id },
    });
    for (const summary of ["Send invoice INV-1001 to Acme", "Publish the spring campaign post"]) {
      await db().approval.create({
        data: { organizationId: setup.org.id, companyId: setup.company.id, taskId: t.id, requestedById: setup.owner.user.id, tool: "send_invoice", toolVersion: 1, input: {}, summary, risk: "MEDIUM", autonomy: "SUPERVISED", requiredPermissions: ["finance.manage"], expiresAt: new Date(Date.now() + 86_400_000) },
      });
    }
    scripted({ intent: "company_question", answer: "Abhi 2 approvals pending hain." });
    const out = await utter(setup.owner.ctx, setup.org.id, setup.company.id, await session(), { text: "kitne approvals pending hain?", inputMode: "text", context: [{ role: "user", text: "hello" }, { role: "assistant", text: "Hi!" }] });
    expect(out.reply.key).toBe("answer");
    const sys = systemOf(calls[1]!);
    expect(sys).toContain("Pending approvals: 2");
    expect(sys).toContain("Send invoice INV-1001 to Acme");
    // Multi-turn context reaches the model.
    expect(calls[1]!.messages[0]).toEqual({ role: "user", content: "hello" });
    expect(calls[1]!.messages.at(-1)).toEqual({ role: "user", content: "kitne approvals pending hain?" });
  });

  it("dispatches 'ek LinkedIn post likho' and says honestly that no worker is running", async () => {
    scripted({ intent: "work_request" });
    const out = await utter(setup.owner.ctx, setup.org.id, setup.company.id, await session(), { text: "ek LinkedIn post likho", inputMode: "text" });
    expect(out.intent).toBe("work_request");
    expect(out.worker).toBe("missing");
    expect(out.run).not.toBeNull();
    expect(out.reply.key).toBe("queuedWorkerDown");
    expect(String(out.reply.params.profiles)).not.toBe("");
  });

  it("keeps the plain 'delegated' reply when a live worker heartbeat exists", async () => {
    await db().platformHeartbeat.create({ data: { id: "worker:test:1", kind: "worker", hostname: "test", pid: 1, startedAt: new Date(), lastSeenAt: new Date() } });
    scripted({ intent: "work_request" });
    const out = await utter(setup.owner.ctx, setup.org.id, setup.company.id, await session(), { text: "write a LinkedIn post about our launch", inputMode: "voice" });
    expect(out.worker).toBe("ok");
    expect(out.reply.key).toBe("delegated");
  });

  it("without AI: heuristic routing and the live numbers, never an invented answer", async () => {
    setModelForTests(null);
    const out = await utter(setup.owner.ctx, setup.org.id, setup.company.id, await session(), { text: "how many approvals are pending?", inputMode: "text" });
    expect(out.routedBy).toBe("heuristic");
    expect(out.intent).toBe("company_question");
    expect(out.reply.key).toBe("status");
    expect(out.reply.params).toMatchObject({ reason: "ai_not_configured", approvals: 2, running: 0 });
  });

  it("records a failed answer for Admin and falls back to the live numbers", async () => {
    scripted({ intent: "conversation", answer: new Error("boom") });
    const sid = await session();
    const out = await utter(setup.owner.ctx, setup.org.id, setup.company.id, sid, { text: "hello there Realy", inputMode: "text" });
    expect(out.reply.key).toBe("statusHello");
    expect(out.reply.params.reason).toBe("ai_failed");
    const failed = await db().agentTask.findFirst({ where: { companyId: setup.company.id, profile: "voice_assistant", status: "FAILED", subjectId: sid } });
    expect(failed?.errorCode).toBe("provider_error");
  });
});
