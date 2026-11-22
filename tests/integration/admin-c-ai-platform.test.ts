import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { db } from "@/server/core/db";
import { userContext } from "@/server/core/context";
import { agentTaskQueue } from "@/server/core/jobs";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { createTask, processAgentTask } from "@/server/modules/agents/service";
import { platformModelCall, quickModelCall, setModelForTests } from "@/server/modules/agents/runtime";
import { resetBreakers } from "@/server/modules/agents/router";
import { flushAiRequestLogs, purgeAiRequestLogs } from "@/server/modules/admin/ai-request-log";
import { aiProviderDetail, aiRequestStats, getAiRequest, listAiRequests } from "@/server/modules/admin/ai-requests";
import { aiBudgetsOverview, budgetRefusal, resetBudgetCaches, updateBudgetRule } from "@/server/modules/admin/ai-budgets";
import { aiCostUsage, searchTasks } from "@/server/modules/admin/ai";
import { simulateRoute, updateTaskTier } from "@/server/modules/admin/ai-models";
import { adminCancelTask, getAdminTask, pauseTask, reassignTask, resumeTask } from "@/server/modules/admin/ai-tasks";
import { employeeLifecycle, employeeMemoryAdmin, getEmployeeDetail } from "@/server/modules/admin/ai-ops";
import { getWorkflowAdmin, listWorkflowsAdmin, workflowAction } from "@/server/modules/admin/workflows-admin";
import { knowledgeAction, knowledgeForOrganization, knowledgeOverview } from "@/server/modules/admin/knowledge-admin";
import { askCopilot, copilotCapabilities } from "@/server/modules/admin/copilot";
import { aiSearch } from "@/server/modules/admin/search/providers/ai";
import { PLATFORM_ID } from "@/server/modules/rbac/scope";
import { expectCode, grant, makeUser, raiseLimits, resetDb } from "../helpers";

// Stream C: AI request log, explorer, budgets, routing v2, task / employee / workflow / knowledge controls, copilot.

beforeAll(async () => {
  await resetDb();
  await resetBreakers();
});
afterEach(() => {
  setModelForTests(null);
  resetBudgetCaches();
});
afterAll(async () => {
  await agentTaskQueue().obliterate({ force: true });
});

function reply(text: string, extra: Partial<BetaMessage> = {}) {
  setModelForTests(async (p) => ({ id: "msg", type: "message", role: "assistant", model: p.model, stop_reason: "end_turn", usage: { input_tokens: 120, output_tokens: 30 }, content: [{ type: "text", text, citations: null }], ...extra }) as unknown as BetaMessage);
}

async function staff(role = "SUPER_ADMIN") {
  const u = await makeUser({ name: `Staff ${role}` });
  await grant(u.user.id, role, "PLATFORM", PLATFORM_ID);
  return { ...u, ctx: userContext(u.user.id, { mfaVerifiedAt: new Date(), sessionId: randomUUID() }) };
}

async function tenant() {
  const owner = await makeUser({ name: "Founder" });
  const org = await createOrganization(owner.ctx, { name: `AdmC ${Math.random()}` });
  await raiseLimits(org.id, { "companies.max": 2 });
  const company = await createCompany(owner.ctx, org.id, { name: "Acme" });
  return { owner, org, company };
}

describe("AI request log", () => {
  it("records every call attempt (success, fallback, error) without content, readable in the explorer", async () => {
    const admin = await staff();
    const { org, company, owner } = await tenant();
    reply("hello");
    await quickModelCall({ organizationId: org.id, companyId: company.id, profileKey: "voice_os", tier: "simple", system: "SECRET SYSTEM PROMPT", messages: [{ role: "user", content: "SECRET QUESTION" }], maxTokens: 50, operation: "test.quick", sourceType: "test", sourceId: randomUUID(), userId: owner.user.id });
    // First model fails (overloaded), the fallback chain serves.
    let n = 0;
    setModelForTests(async (p) => {
      n++;
      if (n === 1) throw Object.assign(new (await import("@anthropic-ai/sdk")).default.InternalServerError(529, undefined, "overloaded", new Headers()), {});
      return { id: "m", type: "message", role: "assistant", model: p.model, stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: "ok", citations: null }] } as unknown as BetaMessage;
    });
    await quickModelCall({ organizationId: org.id, companyId: company.id, profileKey: "voice_os", tier: "standard", system: "s", messages: [{ role: "user", content: "q" }], maxTokens: 50, operation: "test.fallback", sourceType: "test", sourceId: randomUUID() }).catch(() => null);
    await flushAiRequestLogs();

    const rows = await db().aiRequestLog.findMany({ where: { organizationId: org.id }, orderBy: { id: "asc" } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const ok = rows.find((r) => r.operation === "test.quick")!;
    expect(ok.status).toBe("SUCCESS");
    expect(ok.inputTokens).toBe(120);
    expect(ok.outputTokens).toBe(30);
    expect(Number(ok.costMicros)).toBeGreaterThan(0);
    expect(ok.userId).toBe(owner.user.id);
    expect(ok.latencyMs).not.toBeNull();
    // Never any prompt content.
    expect(JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("SECRET");
    const fb = rows.filter((r) => r.operation === "test.fallback");
    expect(fb.some((r) => r.status === "FALLBACK")).toBe(true);

    // Explorer: platform permission required; filters; sensitive fields gated.
    await expectCode(listAiRequests(owner.ctx, {}), "forbidden");
    const list = await listAiRequests(admin.ctx, { org: org.id, window: "1h" });
    expect(list.data.length).toBe(rows.length);
    const ops = await staff("AI_OPERATIONS_ADMIN");
    const detailOps = await getAiRequest(ops.ctx, ok.id);
    expect(detailOps.userId).toBeNull();
    expect(detailOps.userHidden).toBe(true);
    const detailSuper = await getAiRequest(admin.ctx, ok.id);
    expect(detailSuper.userId).toBe(owner.user.id);

    const stats = await aiRequestStats(admin.ctx, { window: "1h" });
    expect(stats.totals.total).toBeGreaterThanOrEqual(rows.length);
    const p = await aiProviderDetail(admin.ctx, "anthropic");
    expect(p.key).toBe("anthropic");
    await expectCode(aiProviderDetail(admin.ctx, "nope"), "not_found");

    // Retention keeps recent rows.
    expect(await purgeAiRequestLogs()).toBe(0);
    await resetBreakers();
  });

  it("/ai/usage reads the cost ledger, including non-agent AI spend", async () => {
    const admin = await staff();
    const { org, company } = await tenant();
    reply("hi");
    await quickModelCall({ organizationId: org.id, companyId: company.id, profileKey: "voice_os", tier: "simple", system: "s", messages: [{ role: "user", content: "q" }], maxTokens: 50, operation: "voiceos.answer", sourceType: "test", sourceId: randomUUID() });
    const u = await aiCostUsage(admin.ctx, { days: 7 });
    expect(u.source).toBe("cost_ledger_entries");
    expect(u.byOperation.some((o) => o.operation === "voiceos.answer")).toBe(true);
  });
});

describe("AI budgets", () => {
  it("hard limits refuse new calls in scope, audited; soft-only limits do not", async () => {
    const admin = await staff();
    const { org, company } = await tenant();
    reply("x");
    await quickModelCall({ organizationId: org.id, companyId: company.id, profileKey: "voice_os", tier: "simple", system: "s", messages: [{ role: "user", content: "q" }], maxTokens: 50, operation: "test.b", sourceType: "test", sourceId: randomUUID() });
    await expectCode(updateBudgetRule((await makeUser()).ctx, { action: "upsert", level: "organization", key: org.id, period: "monthly", limitUsd: 0.01, reason: "test cap" }), "forbidden");
    await updateBudgetRule(admin.ctx, { action: "upsert", level: "organization", key: org.id, period: "monthly", limitUsd: 0.000001 * 1e4, softPct: 50, hard: false, reason: "soft cap" });
    resetBudgetCaches();
    expect(await budgetRefusal({ organizationId: org.id })).toBeNull();
    const o = await aiBudgetsOverview(admin.ctx, { fresh: true });
    const rule = o.rules.find((r) => r.key === org.id)!;
    await updateBudgetRule(admin.ctx, { action: "upsert", id: rule.id, level: "organization", key: org.id, period: "monthly", limitUsd: 0.01, softPct: 50, hard: true, reason: "hard cap" });
    resetBudgetCaches();
    // Spend is tiny but the rule is checked against real ledger spend: below the limit → allowed.
    const spent = Number((await db().costLedgerEntry.aggregate({ where: { organizationId: org.id }, _sum: { costMicros: true } }))._sum.costMicros ?? 0n);
    expect(!!(await budgetRefusal({ organizationId: org.id }))).toBe(spent >= 10_000);
    // Force a limit below the spend: refused before any provider call, and logged as BUDGET_BLOCKED.
    await db().costLedgerEntry.create({ data: { organizationId: org.id, companyId: company.id, category: "AI_TOKENS", provider: "anthropic", model: "claude-haiku-5-5", operation: "test.seed", sourceType: "test", sourceId: randomUUID(), costMicros: 50_000n } });
    resetBudgetCaches();
    await expect(quickModelCall({ organizationId: org.id, companyId: company.id, profileKey: "voice_os", tier: "simple", system: "s", messages: [{ role: "user", content: "q" }], maxTokens: 50, operation: "test.blocked", sourceType: "test", sourceId: randomUUID() })).rejects.toMatchObject({ code: "platform_ai_budget_reached" });
    await flushAiRequestLogs();
    expect(await db().aiRequestLog.count({ where: { organizationId: org.id, status: "BUDGET_BLOCKED" } })).toBe(1);
    // Other organizations are not affected.
    const other = await tenant();
    expect(await budgetRefusal({ organizationId: other.org.id })).toBeNull();
    expect(await db().auditLog.count({ where: { action: { in: ["platform.ai.budget_created", "platform.ai.budget_changed"] }, resourceType: "ai_budget" } })).toBeGreaterThanOrEqual(2);
    await updateBudgetRule(admin.ctx, { action: "delete", id: rule.id, reason: "cleanup" });
  });
});

describe("routing v2", () => {
  it("task-type overrides and the simulator agree with the runtime", async () => {
    const admin = await staff();
    const sim = await simulateRoute(admin.ctx, { profile: "research_analyst", title: "Summarize this", instructions: "short" });
    expect(sim.model).toBeTruthy();
    await updateTaskTier(admin.ctx, { taskType: "research_analyst", tier: "complex", reason: "deep research" });
    const sim2 = await simulateRoute(admin.ctx, { profile: "research_analyst", title: "Summarize this", instructions: "short" });
    expect(sim2.override).toBe("complex");
    expect(sim2.complexityTier).toBe("complex");
    await updateTaskTier(admin.ctx, { taskType: "research_analyst", tier: null, reason: "reset" });
  });
});

describe("AI tasks control center", () => {
  it("pause, resume, reassign and cancel with audit; the worker never runs a paused task", async () => {
    const admin = await staff();
    const { owner, org, company } = await tenant();
    reply("deliverable");
    const task = await createTask(owner.ctx, org.id, company.id, { profile: "research_analyst", title: "Market scan", instructions: "Scan the market" });
    await expectCode(pauseTask(owner.ctx, task.id, { reason: "not staff" }), "forbidden");
    await pauseTask(admin.ctx, task.id, { reason: "investigating spend" });
    expect((await db().agentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("PAUSED");
    expect(await processAgentTask(task.id, `${task.id}_1`, { finalAttempt: true })).toBe("skipped");
    const listed = await searchTasks(admin.ctx, { status: "PAUSED", org: org.id });
    expect(listed.data.map((t) => t.id)).toContain(task.id);

    const detail = await getAdminTask(admin.ctx, task.id);
    expect(detail.status).toBe("PAUSED");
    expect(detail.sensitive).toBe(true);
    const ops = await staff("AI_OPERATIONS_ADMIN");
    const hidden = await getAdminTask(ops.ctx, task.id);
    expect(hidden.content.instructions).toBeNull();

    // Reassign to another AI employee of the same company.
    const emp = await db().aiEmployee.create({ data: { organizationId: org.id, companyId: company.id, name: "Ava", initials: "AV", profileKey: "research_analyst", department: "research", createdById: owner.user.id } });
    await reassignTask(admin.ctx, task.id, { aiEmployeeId: emp.id, reason: "route to Ava" });
    expect((await db().agentTask.findUniqueOrThrow({ where: { id: task.id } })).aiEmployeeId).toBe(emp.id);

    await resumeTask(admin.ctx, task.id, { reason: "resolved" });
    expect((await db().agentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("QUEUED");
    await pauseTask(admin.ctx, task.id, { reason: "again" });
    await adminCancelTask(admin.ctx, task.id, { reason: "not needed" });
    expect((await db().agentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("CANCELLED");
    const actions = (await db().auditLog.findMany({ where: { resourceType: "agent_task", resourceId: task.id, category: "ADMIN" } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["platform.ai.task_paused", "platform.ai.task_resumed", "platform.ai.task_reassigned", "platform.ai.task_cancelled"]));

    // Employee detail, memory purge and disable / enable.
    await db().aiEmployeeMemory.create({ data: { organizationId: org.id, companyId: company.id, aiEmployeeId: emp.id, content: "Prefers bullet points" } });
    const ed = await getEmployeeDetail(admin.ctx, emp.id);
    expect(ed.memory.count).toBe(1);
    await expectCode(employeeMemoryAdmin(admin.ctx, emp.id, { action: "purge", reason: "gdpr", confirm: "nope" }), "validation_error");
    expect((await employeeMemoryAdmin(admin.ctx, emp.id, { action: "purge", reason: "gdpr", confirm: "PURGE" })).removed).toBe(1);
    await employeeLifecycle(admin.ctx, emp.id, { action: "archive", reason: "retire", confirm: "Ava" });
    expect((await db().aiEmployee.findUniqueOrThrow({ where: { id: emp.id } })).archivedAt).not.toBeNull();
    await employeeLifecycle(admin.ctx, emp.id, { action: "restore", reason: "back" });
    const back = await db().aiEmployee.findUniqueOrThrow({ where: { id: emp.id } });
    expect(back.archivedAt).toBeNull();
    expect(back.status).toBe("PAUSED");

    // Search provider: tasks, employees, workflows, models.
    const s = await aiSearch.search(admin.ctx, "Ava");
    expect(s.aiEmployees.map((e) => e.id)).toContain(emp.id);
    expect((await aiSearch.search(admin.ctx, "haiku")).aiModels.length).toBeGreaterThan(0);
  });
});

describe("workflows admin", () => {
  it("lists across organizations and clones / pauses through the automation service, audited", async () => {
    const admin = await staff();
    const { owner, org, company } = await tenant();
    const wf = await db().workflow.create({ data: { organizationId: org.id, companyId: company.id, name: "Lead router", ownerId: owner.user.id, createdById: owner.user.id, draft: { trigger: { type: "manual" }, variables: [], steps: [] } } });
    const list = await listWorkflowsAdmin(admin.ctx, { org: org.id });
    expect(list.data.map((w) => w.id)).toContain(wf.id);
    await expectCode(workflowAction(owner.ctx, wf.id, { action: "clone", reason: "not staff" }), "forbidden");
    const c = await workflowAction(admin.ctx, wf.id, { action: "clone", reason: "copy for debugging" });
    expect(c.id).toBeTruthy();
    expect((await db().workflow.findUniqueOrThrow({ where: { id: c.id as string } })).status).toBe("DRAFT");
    // Enabling an unpublished workflow is refused by the automation service rules.
    await expectCode(workflowAction(admin.ctx, wf.id, { action: "enable", reason: "try it" }), "conflict");
    await expectCode(workflowAction(admin.ctx, wf.id, { action: "run", reason: "try it", confirm: "RUN" }), "conflict");
    await expectCode(workflowAction(admin.ctx, wf.id, { action: "archive", reason: "wrong phrase", confirm: "wrong" }), "validation_error");
    const d = await getWorkflowAdmin(admin.ctx, wf.id);
    expect(d.limits.maxDepth).toBeGreaterThan(0);
  });
});

describe("knowledge admin", () => {
  it("is tenant-isolated: purge needs the typed organization name and touches one company only", async () => {
    const admin = await staff();
    const a = await tenant();
    const b = await tenant();
    for (const t of [a, b]) await db().companyMemory.create({ data: { organizationId: t.org.id, companyId: t.company.id, title: "Fact", fact: "We sell robots", createdById: t.owner.user.id } });
    const ov = await knowledgeOverview(admin.ctx, { fresh: true });
    expect(ov.totals.memories).toBeGreaterThanOrEqual(2);
    const k = await knowledgeForOrganization(admin.ctx, a.org.id);
    expect(k.companyId).toBe(a.company.id);
    // A company of another organization is not reachable through this organization.
    await expectCode(knowledgeAction(admin.ctx, a.org.id, { action: "purge", companyId: b.company.id, scope: "memories", reason: "gdpr", confirm: b.org.name }), "not_found");
    await expectCode(knowledgeAction(admin.ctx, a.org.id, { action: "purge", companyId: a.company.id, scope: "memories", reason: "gdpr", confirm: "wrong" }), "validation_error");
    const r = await knowledgeAction(admin.ctx, a.org.id, { action: "purge", companyId: a.company.id, scope: "memories", reason: "gdpr request", confirm: a.org.name });
    expect(r.ok).toBe(true);
    expect(await db().companyMemory.count({ where: { companyId: a.company.id } })).toBe(0);
    expect(await db().companyMemory.count({ where: { companyId: b.company.id } })).toBe(1);
  });
});

describe("admin copilot", () => {
  it("needs platform.copilot.use, reads only permitted tools, cites them and records cost without a tenant", async () => {
    const plain = await staff("BILLING_ADMIN");
    await expectCode(copilotCapabilities(plain.ctx), "forbidden");
    const ops = await staff("AI_OPERATIONS_ADMIN");
    const caps = await copilotCapabilities(ops.ctx);
    expect(caps.tools.map((t) => t.name)).toContain("top_ai_spenders");
    expect(caps.tools.map((t) => t.name)).not.toContain("past_due_subscriptions");
    let call = 0;
    setModelForTests(async (p) => {
      call++;
      const text = call === 1 ? JSON.stringify({ tools: ["top_ai_spenders", "past_due_subscriptions"] }) : "The top spender is listed in [T1].";
      return { id: "m", type: "message", role: "assistant", model: p.model, stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 10 }, content: [{ type: "text", text, citations: null }] } as unknown as BetaMessage;
    });
    const r = await askCopilot(ops.ctx, { question: "Who spends the most on AI?" });
    expect(r.answer).toContain("[T1]");
    // A tool outside the admin's permissions is never run, even when the model asks for it.
    expect(r.sources.map((s) => s.tool)).toEqual(["top_ai_spenders"]);
    await flushAiRequestLogs();
    expect(await db().aiRequestLog.count({ where: { operation: "admin.copilot", organizationId: null, userId: ops.user.id, status: "SUCCESS" } })).toBe(2);
    expect(await db().auditLog.count({ where: { action: "platform.copilot.tool_called", actorId: ops.user.id } })).toBe(1);
    // Platform calls never write a tenant cost ledger row.
    reply("plain");
    await platformModelCall({ userId: ops.user.id, profileKey: "admin_copilot", tier: "simple", system: "s", messages: [{ role: "user", content: "q" }], maxTokens: 20, operation: "admin.copilot", sourceType: "admin_copilot", sourceId: randomUUID() });
    expect(await db().costLedgerEntry.count({ where: { operation: "admin.copilot" } })).toBe(0);
  });
});
