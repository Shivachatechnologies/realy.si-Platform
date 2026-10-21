import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { db } from "@/server/core/db";
import { agentTaskQueue } from "@/server/core/jobs";
import { acceptInvitation, createOrganization, inviteMember } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { revokeAssignment, systemRoleId } from "@/server/modules/rbac/service";
import { ingestDocument } from "@/server/modules/brain/service";
import { createEntity } from "@/server/modules/graph/service";
import { createSession, SESSION_COOKIE } from "@/server/modules/auth/session";
import { cancelTask, createTask, failStaleTasks, getTask, listTasks, processAgentTask, retryTask } from "@/server/modules/agents/service";
import { setModelForTests } from "@/server/modules/agents/runtime";
import { POST as createRoute, GET as listRoute } from "@/app/api/v1/organizations/[orgId]/companies/[companyId]/tasks/route";
import { expectCode, makeUser, resetDb } from "../helpers";
import { params, req } from "../http";

beforeAll(resetDb);
afterEach(() => setModelForTests(null));
afterAll(async () => {
  await agentTaskQueue().obliterate({ force: true });
});

type Step = (p: MessageCreateParamsNonStreaming) => Partial<BetaMessage> | Error;

/** A scripted model: each call returns the next step's message (or throws its error) and records the request. */
function script(...steps: Step[]) {
  const calls: MessageCreateParamsNonStreaming[] = [];
  setModelForTests(async (p) => {
    calls.push(structuredClone(p));
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    const r = step(p);
    if (r instanceof Error) throw r;
    return { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 }, content: [], ...r } as BetaMessage;
  });
  return calls;
}
const toolUse = (name: string, input: object, id = `tu_${name}`): Step => () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input } as never] });
const answer = (text: string): Step => () => ({ stop_reason: "end_turn", content: [{ type: "text", text, citations: null } as never] });
const lastToolResult = (calls: MessageCreateParamsNonStreaming[], i: number) => {
  const msg = calls[i]!.messages.at(-1)!;
  return (msg.content as { content: string; is_error?: boolean }[])[0]!;
};

async function setup() {
  const owner = await makeUser({ name: "Founder" });
  const org = await createOrganization(owner.ctx, { name: `Tasks ${Math.random()}` });
  const company = await createCompany(owner.ctx, org.id, { name: "Acme Robotics", incorporationCountryCode: "US" });
  return { owner, org, company };
}

async function joinAs(ownerCtx: Parameters<typeof inviteMember>[0], orgId: string, companyId: string, roleKey: string) {
  const u = await makeUser();
  const { token } = await inviteMember(ownerCtx, orgId, { email: u.user.email, roleId: await systemRoleId(db(), roleKey), scopeType: "COMPANY", scopeId: companyId });
  await acceptInvitation(u.ctx, token);
  return u;
}

const run = (taskId: string, jobId = `${taskId}_1`, finalAttempt = true) => processAgentTask(taskId, jobId, { finalAttempt });

describe("AI tasks", () => {
  it("refuses tasks when no AI provider is configured — nothing is simulated", async () => {
    const { owner, org, company } = await setup();
    const err = (await expectCode(createTask(owner.ctx, org.id, company.id, { profile: "research_analyst", title: "T", instructions: "Do it" }), "not_configured")) as { details?: { reason?: string } };
    expect(err.details?.reason).toBe("ai_not_configured");
    expect(await db().agentTask.count({ where: { companyId: company.id } })).toBe(0);
  });

  it("executes with company context: searches the Brain, reads the Graph, stores the deliverable with real citations", async () => {
    const { owner, org, company } = await setup();
    const doc = await ingestDocument(owner.ctx, org.id, company.id, { filename: "pricing.md", content: "# Pricing\n\nThe Pro plan costs 49 USD per month and includes priority support." });
    await createEntity(owner.ctx, org.id, company.id, { kind: "PRODUCT", name: "Acme Arm" });
    // A different tenant's document with the same words must never be retrieved.
    const other = await setup();
    await ingestDocument(other.owner.ctx, other.org.id, other.company.id, { content: "Pro plan pricing secret: 1 USD" });

    const calls = script(
      toolUse("search_company_brain", { query: "Pro plan pricing" }),
      toolUse("read_company_graph", {}),
      answer("The Pro plan is 49 USD per month [S1]. Acme Arm is the flagship product. Unsupported claim [S7]."),
    );
    const task = await createTask(owner.ctx, org.id, company.id, { profile: "sales_researcher", title: "Pricing brief", instructions: "Summarize our pricing" });
    expect(task.status).toBe("QUEUED");
    expect(await agentTaskQueue().getJob(`${task.id}_1`)).toBeTruthy();

    expect(await run(task.id)).toBe("completed");
    const brainResult = lastToolResult(calls, 1);
    expect(brainResult.content).toContain("[S1] pricing — passage 1");
    expect(brainResult.content).toContain("49 USD");
    expect(brainResult.content).not.toContain("secret");
    expect(lastToolResult(calls, 2).content).toContain("PRODUCT Acme Arm");
    // System prompt carries the role and the company; tools are the profile's.
    expect(calls[0]!.system).toContain("sales researcher");
    expect(calls[0]!.system).toContain("Acme Robotics");
    expect(calls[0]!.tools!.map((t) => (t as { name: string }).name)).toEqual(["search_company_brain", "read_company_graph", "read_objectives", "create_graph_entity"]);

    const done = await getTask(owner.ctx, org.id, company.id, task.id);
    expect(done).toMatchObject({ status: "COMPLETED", attempts: 1, model: "claude-opus-5-5", inputTokens: 300, outputTokens: 150, errorCode: null });
    expect(done.output).toContain("49 USD");
    // Only [S1] is a source this task retrieved; the invented [S7] is not stored as a citation.
    expect(done.citations).toEqual([{ ref: "S1", documentId: doc.id, passageId: expect.any(String), title: "pricing", passage: 1 }]);
    expect(done.toolCalls).toEqual([
      { tool: "search_company_brain", input: { query: "Pro plan pricing" }, results: 1 },
      { tool: "read_company_graph", input: {}, results: 1 },
    ]);
    expect(done.startedAt).toBeTruthy();
    expect(done.completedAt).toBeTruthy();
    expect(await db().auditLog.count({ where: { organizationId: org.id, action: { in: ["agent.task.created", "agent.task.completed"] } } })).toBe(2);
  });

  it("executes a job at most once: duplicate or stale jobs are skipped", async () => {
    const { owner, org, company } = await setup();
    const calls = script(answer("Done."));
    const task = await createTask(owner.ctx, org.id, company.id, { profile: "research_analyst", title: "Once", instructions: "x" });
    expect(await run(task.id)).toBe("completed");
    expect(await run(task.id)).toBe("skipped"); // same job delivered again after completion
    expect(await run(task.id, `${task.id}_other`)).toBe("skipped"); // a second job for the same task
    expect(calls).toHaveLength(1);
  });

  it("retries transient provider failures through the queue, then records a safe failure", async () => {
    const { owner, org, company } = await setup();
    script(() => new Anthropic.APIConnectionError({ message: "socket hang up (secret-host:443)" }));
    const task = await createTask(owner.ctx, org.id, company.id, { profile: "research_analyst", title: "Flaky", instructions: "x" });
    await expect(processAgentTask(task.id, `${task.id}_1`, { finalAttempt: false })).rejects.toThrow(); // queue will retry
    expect((await getTask(owner.ctx, org.id, company.id, task.id)).status).toBe("RUNNING");
    expect(await processAgentTask(task.id, `${task.id}_1`, { finalAttempt: true })).toBe("failed"); // same job, last attempt
    const failed = await getTask(owner.ctx, org.id, company.id, task.id);
    expect(failed).toMatchObject({ status: "FAILED", attempts: 2, errorCode: "provider_unavailable", errorMessage: "The AI provider is temporarily unavailable", output: null });
    expect(JSON.stringify(failed)).not.toContain("secret-host");

    // Retry runs a new execution and can succeed.
    script(answer("Recovered."));
    const retried = await retryTask(owner.ctx, org.id, company.id, task.id);
    expect(retried).toMatchObject({ status: "QUEUED", errorCode: null });
    expect(await run(task.id, `${task.id}_3`)).toBe("completed");
    expect((await getTask(owner.ctx, org.id, company.id, task.id)).output).toBe("Recovered.");
    await expectCode(retryTask(owner.ctx, org.id, company.id, task.id), "conflict"); // completed tasks are not retried
  });

  it("fails permanently on refusals, bad credentials, empty output and runaway loops", async () => {
    const { owner, org, company } = await setup();
    const cases: [Step[], string][] = [
      [[() => ({ stop_reason: "refusal", content: [] })], "refused"],
      [[() => new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key sk-ant-secret", new Headers())], "provider_auth"],
      [[answer("   ")], "empty_output"],
      [[toolUse("search_company_brain", { query: "loop" })], "turn_limit"],
      [[toolUse("delete_everything", {})], "turn_limit"],
    ];
    for (const [steps, code] of cases) {
      const calls = script(...steps);
      const task = await createTask(owner.ctx, org.id, company.id, { profile: "research_analyst", title: code, instructions: "x" });
      expect(await processAgentTask(task.id, `${task.id}_1`, { finalAttempt: false })).toBe("failed");
      const t = await getTask(owner.ctx, org.id, company.id, task.id);
      expect(t).toMatchObject({ status: "FAILED", errorCode: code });
      expect(JSON.stringify(t)).not.toContain("sk-ant");
      if (code === "turn_limit") expect(calls).toHaveLength(8); // bounded by the profile's maxTurns
    }
    // An unknown tool is refused to the model as an error result, never executed.
    const calls = script(toolUse("delete_everything", {}), answer("ok"));
    const task = await createTask(owner.ctx, org.id, company.id, { profile: "research_analyst", title: "tool", instructions: "x" });
    await run(task.id);
    expect(lastToolResult(calls, 1)).toMatchObject({ is_error: true, content: "Unknown tool delete_everything" });
  });

  it("cancels queued and running tasks; a running execution never overwrites the cancellation", async () => {
    const { owner, org, company } = await setup();
    script(answer("x"));
    const queued = await createTask(owner.ctx, org.id, company.id, { profile: "research_analyst", title: "Q", instructions: "x" });
    await cancelTask(owner.ctx, org.id, company.id, queued.id);
    expect(await run(queued.id)).toBe("skipped");
    expect((await getTask(owner.ctx, org.id, company.id, queued.id)).status).toBe("CANCELLED");
    await expectCode(cancelTask(owner.ctx, org.id, company.id, queued.id), "conflict");

    const running = await createTask(owner.ctx, org.id, company.id, { profile: "research_analyst", title: "R", instructions: "x" });
    // Cancelled while the model works: the late result must not be stored.
    setModelForTests(async () => {
      await cancelTask(owner.ctx, org.id, company.id, running.id);
      return { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "late result", citations: null }] } as unknown as BetaMessage;
    });
    expect(await run(running.id)).toBe("skipped");
    const t = await getTask(owner.ctx, org.id, company.id, running.id);
    expect(t.status).toBe("CANCELLED");
    expect(t.output).toBeNull();
  });

  it("isolates tenants and enforces roles; executes with the requester's current permissions", async () => {
    const a = await setup();
    const b = await setup();
    script(answer("x"));
    const task = await createTask(a.owner.ctx, a.org.id, a.company.id, { profile: "research_analyst", title: "A", instructions: "x" });
    for (const call of [
      () => getTask(b.owner.ctx, a.org.id, a.company.id, task.id),
      () => getTask(b.owner.ctx, b.org.id, b.company.id, task.id),
      () => listTasks(b.owner.ctx, a.org.id, a.company.id),
      () => cancelTask(b.owner.ctx, b.org.id, b.company.id, task.id),
      () => retryTask(b.owner.ctx, b.org.id, b.company.id, task.id),
      () => createTask(b.owner.ctx, a.org.id, a.company.id, { profile: "research_analyst", title: "x", instructions: "x" }),
      () => getTask(a.owner.ctx, a.org.id, a.company.id, "not-a-uuid"),
    ]) await expectCode(call(), "not_found");

    const viewer = await joinAs(a.owner.ctx, a.org.id, a.company.id, "VIEWER");
    const member = await joinAs(a.owner.ctx, a.org.id, a.company.id, "MEMBER");
    const manager = await joinAs(a.owner.ctx, a.org.id, a.company.id, "MANAGER");
    for (const u of [viewer, member]) {
      expect((await listTasks(u.ctx, a.org.id, a.company.id)).data).toHaveLength(1);
      await expectCode(createTask(u.ctx, a.org.id, a.company.id, { profile: "research_analyst", title: "x", instructions: "x" }), "forbidden");
      await expectCode(cancelTask(u.ctx, a.org.id, a.company.id, task.id), "forbidden");
    }
    const mine = await createTask(manager.ctx, a.org.id, a.company.id, { profile: "product_manager", title: "PRD", instructions: "x" });
    // The manager loses the role before the task runs: it fails instead of running with stale authority.
    const assignment = await db().roleAssignment.findFirstOrThrow({ where: { organizationId: a.org.id, principalId: manager.user.id } });
    await revokeAssignment(a.owner.ctx, a.org.id, assignment.id);
    expect(await run(mine.id)).toBe("failed");
    expect(await getTask(a.owner.ctx, a.org.id, a.company.id, mine.id)).toMatchObject({ status: "FAILED", errorCode: "permission_denied" });
  });

  it("fails executions lost with the worker so they can be retried", async () => {
    const { owner, org, company } = await setup();
    script(answer("x"));
    const task = await createTask(owner.ctx, org.id, company.id, { profile: "research_analyst", title: "Lost", instructions: "x" });
    await db().agentTask.update({ where: { id: task.id }, data: { status: "RUNNING", runToken: "gone", startedAt: new Date(Date.now() - 3_600_000) } });
    expect(await failStaleTasks()).toBeGreaterThanOrEqual(1);
    expect(await getTask(owner.ctx, org.id, company.id, task.id)).toMatchObject({ status: "FAILED", errorCode: "interrupted" });
  });

  it("serves tasks over the API with validation and authentication", async () => {
    const { owner, org, company } = await setup();
    script(answer("x"));
    const { token } = await createSession(db(), owner.user.id, { mfaPending: false, mfaVerifiedAt: new Date() });
    const cookie = `${SESSION_COOKIE}=${token}`;
    const p = params({ orgId: org.id, companyId: company.id });
    const base = `/api/v1/organizations/${org.id}/companies/${company.id}/tasks`;
    const created = await createRoute(req(base, { cookie, body: { profile: "marketing_strategist", title: "Launch plan", instructions: "Plan the launch" } }), p);
    expect(created.status).toBe(200);
    expect((await createRoute(req(base, { cookie, body: { profile: "ceo_bot", title: "x", instructions: "x" } }), p)).status).toBe(400);
    expect((await createRoute(req(base, { cookie, body: { profile: "research_analyst", title: "", instructions: "x" } }), p)).status).toBe(400);
    expect((await createRoute(req(base, { body: { profile: "research_analyst", title: "x", instructions: "x" } }), p)).status).toBe(401);
    const list = await (await listRoute(req(base, { cookie }), p)).json();
    expect(list.data).toEqual([expect.objectContaining({ title: "Launch plan", status: "QUEUED" })]);
    expect(list.data[0]).not.toHaveProperty("runToken");
    setModelForTests(null);
    const unconfigured = await createRoute(req(base, { cookie, body: { profile: "research_analyst", title: "x", instructions: "x" } }), p);
    expect(unconfigured.status).toBe(501);
  });
});
