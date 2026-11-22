import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { db } from "@/server/core/db";
import { agentTaskQueue } from "@/server/core/jobs";
import type { OutboxEvent } from "@/server/modules/events/relay";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { createTask, MAX_PARKS, processAgentTask, sweepParkedTasks } from "@/server/modules/agents/service";
import { setModelForTests } from "@/server/modules/agents/runtime";
import { profileByKey } from "@/server/modules/agents/profiles";
import { setProviderFetchForTests } from "@/server/modules/agents/providers";
import { resetBreakers } from "@/server/modules/agents/router";
import { decideApproval, failInterruptedApprovals, listApprovals, retryApproval } from "@/server/modules/approvals/service";
import { handleApprovalResolved } from "@/server/modules/approvals/jobs";
import { getCommandSession, runCommand } from "@/server/modules/guide/command";
import { advanceRunForTask } from "@/server/modules/guide/command-run";
import { createGoal, listGoalsWithBudgets } from "@/server/modules/objectives/goals";
import { createEmployee } from "@/server/modules/workforce/service";
import { createSchedule, runDueSchedules } from "@/server/modules/workforce/schedules";
import { createRole } from "@/server/modules/workforce/roles";
import { expectCode, makeUser, raiseLimits, resetDb } from "../helpers";

/**
 * G1 acceptance (GAP-MATRIX §3, the steps inside G1's scope) with provider stubs: company → goal with budget →
 * AI Command (model-based understanding) → plan → delegation → a step files an approval and parks → the founder
 * approves → the step resumes with the outcome → dependent step → CEO review → result stored in Company Brain; failed
 * approved actions are retried; monthly schedules fire; AI spend reaches the goal's budget vs actual; the runtime falls
 * back across providers (OpenAI → Gemini stubs); kill switch and loop guards hold. No real provider is contacted.
 */

// The worker's locale-less translator (as in production worker runs); next/root-params only exists inside Next.
vi.mock("@/i18n/server", () => import("@/worker/i18n-server"));

beforeAll(resetDb);
afterEach(async () => {
  setModelForTests(null);
  setProviderFetchForTests(null);
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  await resetBreakers();
});
afterAll(async () => {
  await agentTaskQueue().obliterate({ force: true });
});

type Req = MessageCreateParamsNonStreaming;
const base = { id: "msg_stub", type: "message", role: "assistant", model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 50 } };
const text = (t: string) => ({ ...base, stop_reason: "end_turn", content: [{ type: "text", text: t, citations: null }] }) as unknown as BetaMessage;
const tool = (name: string, input: object, id = `tu_${name}`) => ({ ...base, stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] }) as unknown as BetaMessage;
const systemOf = (p: Req) => (typeof p.system === "string" ? p.system : (p.system ?? []).map((b) => ("text" in b ? b.text : "")).join("\n"));
const lastUserText = (p: Req) => JSON.stringify(p.messages.at(-1)?.content ?? "");
const resolvedEvent = (a: { id: string; organizationId: string; companyId: string }) => ({ id: `evt_${a.id}`, type: "approval.resolved", aggregateType: "approval", aggregateId: a.id, organizationId: a.organizationId, companyId: a.companyId, payload: {}, occurredAt: new Date() }) as unknown as OutboxEvent;

async function setup() {
  const owner = await makeUser({ name: "Founder" });
  const org = await createOrganization(owner.ctx, { name: `G1 ${Math.random()}` });
  await raiseLimits(org.id, { "companies.max": 3, "agents.max": 20 });
  const company = await createCompany(owner.ctx, org.id, { name: "Acme Robotics", incorporationCountryCode: "US" });
  return { owner, org, company };
}

describe("G1 acceptance flow (§3 within orchestration, CEO, workforce, models and approvals)", () => {
  it("command → plan with dependencies → approval parks the step → approve → resume → review → Brain; budget vs actual", async () => {
    const { owner, org, company } = await setup();
    // Step 2–3: an objective with a persisted budget (B15).
    const goal = await createGoal(owner.ctx, org.id, company.id, { title: "Launch the pilot programme", budget: { amount: "0.05", currency: "USD" } });
    expect(goal.budgetMinor).toBe(5n);

    // Provider stub: the classifier (B26), then each step by role.
    const seen: { kind: string; system: string }[] = [];
    setModelForTests(async (p) => {
      const sys = systemOf(p);
      if (sys.includes("You route a founder's command")) {
        seen.push({ kind: "classify", system: sys });
        return text(JSON.stringify({ departments: [{ key: "operations", needs: [] }, { key: "analytics", needs: ["operations"] }], research: false }));
      }
      if (sys.includes("operations assistant")) {
        // First turn files an approval; after resuming it sees the outcome and finishes.
        if (lastUserText(p).includes("Approval outcomes")) return text("Created the pilot project after approval.\n\nNext step: invite the pilot customers");
        return tool("create_project", { name: "Pilot programme" });
      }
      if (sys.includes("AI CEO")) return text("Review: the pilot project exists and the KPI baseline is set.\n\nNext step: book the first pilot call");
      return text("Analytics: baseline KPIs recorded for the pilot.");
    });

    const session = await runCommand(owner.ctx, org.id, company.id, { text: "Set up the pilot programme and track how it performs", locale: "en-US" });
    expect(seen.filter((s) => s.kind === "classify")).toHaveLength(1);
    const run = session.runs[0]!;
    expect(run.understanding.classifier).toBe("model");
    expect(run.steps.map((s) => `${s.kind}:${s.intent}`)).toEqual(["DEPARTMENT:operations", "DEPARTMENT:analytics", "REVIEW:review"]);
    expect(run.steps[1]!.dependsOn).toEqual([0]); // analytics waits for operations
    const ops = run.steps[0]!;
    expect(ops.status).toBe("DELEGATED");
    expect(run.steps[1]!.status).toBe("WAITING");

    // Step 6/8: the operations step files an approval and parks (B27) instead of finishing with "pending" prose.
    expect(await processAgentTask(ops.task!.id, `${ops.task!.id}_1`, { finalAttempt: true })).toBe("parked");
    const parked = await db().agentTask.findUniqueOrThrow({ where: { id: ops.task!.id } });
    expect(parked.status).toBe("WAITING_APPROVAL");
    const [approval] = await listApprovals(owner.ctx, org.id, company.id, { status: "PENDING" });
    expect(approval).toMatchObject({ tool: "create_project", taskId: ops.task!.id, commandRunId: run.id });
    // A dependent step never starts while its dependency waits.
    await advanceRunForTask(org.id, company.id, ops.task!.id);
    expect((await db().commandPlanStep.findFirstOrThrow({ where: { runId: run.id, position: 1 } })).status).toBe("WAITING");

    // Approve → executes once → the outcome flows back (B3) and the parked step resumes with it.
    expect(await decideApproval(owner.ctx, org.id, company.id, approval!.id, { decision: "approve" })).toMatchObject({ status: "EXECUTED" });
    expect(await db().project.count({ where: { companyId: company.id, name: "Pilot programme" } })).toBe(1);
    await handleApprovalResolved(resolvedEvent(approval!));
    expect((await db().agentTask.findUniqueOrThrow({ where: { id: ops.task!.id } })).status).toBe("QUEUED");
    expect(await processAgentTask(ops.task!.id, `${ops.task!.id}_2`, { finalAttempt: true })).toBe("completed");
    const done = await db().agentTask.findUniqueOrThrow({ where: { id: ops.task!.id } });
    expect(done.output).toContain("after approval");
    expect(await db().auditLog.count({ where: { action: "guide.command.approval_outcome", resourceId: run.id } })).toBe(1);

    // Dependent analytics step, then the CEO review; the run completes and its synthesis lands in Company Brain.
    await advanceRunForTask(org.id, company.id, ops.task!.id);
    const analytics = await db().commandPlanStep.findFirstOrThrow({ where: { runId: run.id, position: 1 } });
    expect(analytics.status).toBe("DELEGATED");
    expect(await processAgentTask(analytics.taskId!, `${analytics.taskId}_1`, { finalAttempt: true })).toBe("completed");
    await advanceRunForTask(org.id, company.id, analytics.taskId!);
    const review = await db().commandPlanStep.findFirstOrThrow({ where: { runId: run.id, position: 2 } });
    expect(await processAgentTask(review.taskId!, `${review.taskId}_1`, { finalAttempt: true })).toBe("completed");
    await advanceRunForTask(org.id, company.id, review.taskId!);
    const view = await getCommandSession(owner.ctx, org.id, company.id, session.id);
    expect(view.runs[0]).toMatchObject({ status: "COMPLETED", nextAction: "book the first pilot call" });
    expect(view.runs[0]!.documentId).toBeTruthy();

    // Budget vs actual (B15): AI spend of the goal's work is real ledger spend.
    const task = await createTask(owner.ctx, org.id, company.id, { profile: "research_analyst", title: "Pilot research", instructions: "x", subject: { type: "company_goal", id: goal.id } });
    expect(await processAgentTask(task.id, `${task.id}_1`, { finalAttempt: true })).toBe("completed");
    const [withBudget] = await listGoalsWithBudgets(owner.ctx, org.id, company.id);
    expect(withBudget!.budgetStatus.budget).toMatchObject({ amount: "0.05", currency: "USD" });
    expect(withBudget!.budgetStatus.actual.micros).toBeGreaterThan(0);
    expect(withBudget!.budgetStatus.usedPct).not.toBeNull();
  });

  it("a failed approved action is retried (B3) and its outcome is written back to the requesting task", async () => {
    const { owner, org, company } = await setup();
    setModelForTests(async (p) => (p.messages.length === 1 ? tool("create_project", { name: "Retry me" }) : text("Proposed the project.")));
    const task = await createTask(owner.ctx, org.id, company.id, { profile: "operations_assistant", title: "Plan", instructions: "x" });
    expect(await processAgentTask(task.id, `${task.id}_1`, { finalAttempt: true })).toBe("completed"); // not parked: no opt-in
    const [a] = await listApprovals(owner.ctx, org.id, company.id, { status: "PENDING" });
    // The execution was lost mid-way (the request died): the sweep marks it FAILED so it can be retried.
    await db().approval.update({ where: { id: a!.id }, data: { status: "APPROVED", decidedById: owner.user.id, decidedAt: new Date(Date.now() - 20 * 60_000), lastAttemptAt: new Date(Date.now() - 20 * 60_000), attempts: 1 } });
    expect(await failInterruptedApprovals()).toBe(1);
    await expectCode(decideApproval(owner.ctx, org.id, company.id, a!.id, { decision: "approve" }), "conflict");
    const out = await retryApproval(owner.ctx, org.id, company.id, a!.id);
    expect(out).toMatchObject({ status: "EXECUTED", queued: false });
    expect((await db().approval.findUniqueOrThrow({ where: { id: a!.id } })).attempts).toBe(2);
    await expectCode(retryApproval(owner.ctx, org.id, company.id, a!.id), "conflict"); // only FAILED can be retried
    await handleApprovalResolved(resolvedEvent(a!));
    const calls = (await db().agentTask.findUniqueOrThrow({ where: { id: task.id } })).toolCalls as { approvalId?: string; approvalStatus?: string }[];
    expect(calls.find((c) => c.approvalId === a!.id)?.approvalStatus).toBe("EXECUTED");
    // Another tenant can neither see nor retry it.
    const other = await setup();
    await expectCode(retryApproval(other.owner.ctx, other.org.id, other.company.id, a!.id), "not_found");
  });

  it("loop guards: a task parks at most MAX_PARKS times; the kill switch stops resumed work", async () => {
    const { owner, org, company } = await setup();
    let n = 0;
    // A model that asks for an approval on every turn: parking must stop after MAX_PARKS and the turn limit must end it.
    setModelForTests(async () => (++n, tool("create_project", { name: `Loop ${n}` }, `tu_${n}`)));
    const task = await createTask(owner.ctx, org.id, company.id, { profile: "operations_assistant", title: "Loop", instructions: "x" }, { parkOnApproval: true });
    let attempt = 1;
    for (let i = 0; i < MAX_PARKS; i++) {
      expect(await processAgentTask(task.id, `${task.id}_${attempt++}`, { finalAttempt: true })).toBe("parked");
      await db().approval.updateMany({ where: { taskId: task.id, status: "PENDING" }, data: { status: "REJECTED", decidedById: owner.user.id, decidedAt: new Date() } });
      expect(await sweepParkedTasks()).toBe(1);
    }
    // No more parks: the run continues and ends at the profile's turn limit instead of looping forever.
    expect(await processAgentTask(task.id, `${task.id}_${attempt++}`, { finalAttempt: true })).toBe("failed");
    const t = await db().agentTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(t.errorCode).toBe("turn_limit");
    expect(n).toBeLessThanOrEqual(profileByKey("operations_assistant")!.maxTurns);

    // Kill switch: a parked task whose approvals are decided resumes into a refusal, never into work.
    setModelForTests(async (p) => (p.messages.length === 1 ? tool("create_project", { name: "Paused" }) : text("done")));
    const t2 = await createTask(owner.ctx, org.id, company.id, { profile: "operations_assistant", title: "Paused", instructions: "x" }, { parkOnApproval: true });
    expect(await processAgentTask(t2.id, `${t2.id}_1`, { finalAttempt: true })).toBe("parked");
    await db().approval.updateMany({ where: { taskId: t2.id }, data: { status: "REJECTED", decidedById: owner.user.id, decidedAt: new Date() } });
    await db().autonomySettings.upsert({ where: { companyId: company.id }, create: { organizationId: org.id, companyId: company.id, paused: true }, update: { paused: true } });
    expect(await sweepParkedTasks()).toBe(1);
    expect(await processAgentTask(t2.id, `${t2.id}_2`, { finalAttempt: true })).toBe("failed");
    expect((await db().agentTask.findUniqueOrThrow({ where: { id: t2.id } })).errorCode).toBe("company_ai_paused");
    // Commands still route (keyword fallback, no model call) but no step starts while paused.
    let modelCalls = 0;
    setModelForTests(async () => (modelCalls++, text("x")));
    const s = await runCommand(owner.ctx, org.id, company.id, { text: "Prepare the finance report", locale: "en-US" });
    expect(modelCalls).toBe(0);
    expect(s.runs[0]!.understanding.classifier).toBe("keywords");
    expect(s.runs[0]!.steps.every((st) => st.status === "BLOCKED" && st.errorReason === "workforce_ai_paused")).toBe(true);
  });

  it("monthly schedules (B18), company-defined roles (B24) and the executive roster (B6, B25)", async () => {
    const { owner, org, company } = await setup();
    setModelForTests(async () => text("Monthly pack ready."));
    const cfo = await createEmployee(owner.ctx, org.id, company.id, { profileKey: "ai_cfo", name: "Ada" });
    const s = await createSchedule(owner.ctx, org.id, company.id, { aiEmployeeId: cfo.id, name: "CFO monthly pack", kind: "RECURRING", frequency: "MONTHLY", dayOfMonth: 1, timeOfDay: "08:00", instructions: "Prepare the monthly finance pack for {{date}}." });
    expect(s).toMatchObject({ frequency: "MONTHLY", dayOfMonth: 1 });
    await db().aiSchedule.update({ where: { id: s.id }, data: { lastSlot: "M2000-01" } });
    const day = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 2, 9));
    expect(await runDueSchedules(day)).toBe(1);
    expect(await runDueSchedules(new Date(day.getTime() + 86_400_000))).toBe(0); // one run per month
    expect(await db().agentTask.count({ where: { companyId: company.id, aiEmployeeId: cfo.id } })).toBe(1);

    // A role defined as data, with tools from the registry only, runs on the same runtime and gateway.
    const role = await createRole(owner.ctx, org.id, company.id, { name: "Partnerships lead", department: "sales", instructions: "Find partnership opportunities from the company's records and report them.", tools: ["search_company_brain", "read_company_graph"], maxTurns: 4 });
    expect(role.key).toBe("custom_partnerships_lead");
    await expectCode(createRole(owner.ctx, org.id, company.id, { name: "Bad", department: "sales", instructions: "Tries to get a tool that does not exist at all.", tools: ["transfer_all_money"] }), "validation_error");
    const offered: string[][] = [];
    setModelForTests(async (p) => (offered.push((p.tools ?? []).map((t) => (t as { name: string }).name)), text("Two partner ideas.")));
    const task = await createTask(owner.ctx, org.id, company.id, { profile: role.key, title: "Partners", instructions: "x" });
    expect(await processAgentTask(task.id, `${task.id}_1`, { finalAttempt: true })).toBe("completed");
    expect(offered[0]).toEqual(expect.arrayContaining(["search_company_brain", "read_company_graph", "delegate_to_ai_employee"]));
    expect(offered[0]).not.toContain("create_project");
    // Another company cannot use this company's role.
    const other = await setup();
    await expectCode(createTask(other.owner.ctx, other.org.id, other.company.id, { profile: role.key, title: "x", instructions: "x" }), "not_found");

    for (const key of ["ai_ceo", "ai_coo"]) expect(profileByKey(key)!.tools).toEqual(expect.arrayContaining(["read_spending", "read_autopilot_status"]));
    for (const key of ["ai_clo", "ai_ciso", "ai_cdo"]) expect(profileByKey(key)?.department).toBe("executive");
  });

  it("multi-provider runtime (B13): no Anthropic key → OpenAI; OpenAI down → Gemini; cost recorded per provider", async () => {
    const { owner, org, company } = await setup();
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key-000000000000";
    process.env.GEMINI_API_KEY = "test-gemini-key-not-real-0000000000000";
    const hosts: string[] = [];
    let openAiDown = false;
    setProviderFetchForTests(async (url) => {
      const u = new URL(String(url));
      hosts.push(u.host);
      if (u.host === "api.openai.com") {
        if (openAiDown) return new Response("{}", { status: 503 });
        return Response.json({ model: "gpt-5", choices: [{ finish_reason: "stop", message: { content: "Answer from the OpenAI stub." } }], usage: { prompt_tokens: 200, completion_tokens: 40 } });
      }
      return Response.json({ modelVersion: "gemini-2.5-pro", candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Answer from the Gemini stub." }] } }], usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 30 } });
    });
    const t1 = await createTask(owner.ctx, org.id, company.id, { profile: "research_analyst", title: "Summarize our documents", instructions: "Summarize." });
    expect(await processAgentTask(t1.id, `${t1.id}_1`, { finalAttempt: true })).toBe("completed");
    expect(await db().agentTask.findUniqueOrThrow({ where: { id: t1.id } })).toMatchObject({ output: "Answer from the OpenAI stub.", model: "gpt-5" });
    expect(await db().costLedgerEntry.findFirst({ where: { taskId: t1.id }, select: { provider: true, model: true } })).toEqual({ provider: "openai", model: "gpt-5" });

    openAiDown = true;
    const t2 = await createTask(owner.ctx, org.id, company.id, { profile: "research_analyst", title: "Summarize again", instructions: "Summarize again, differently." });
    expect(await processAgentTask(t2.id, `${t2.id}_1`, { finalAttempt: true })).toBe("completed");
    expect((await db().agentTask.findUniqueOrThrow({ where: { id: t2.id } })).output).toBe("Answer from the Gemini stub.");
    expect(await db().costLedgerEntry.findFirst({ where: { taskId: t2.id }, select: { provider: true } })).toEqual({ provider: "gemini" });
    expect(hosts.every((h) => h === "api.openai.com" || h === "generativelanguage.googleapis.com")).toBe(true);
  });
});
