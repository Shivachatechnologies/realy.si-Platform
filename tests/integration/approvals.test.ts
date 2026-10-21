import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { db } from "@/server/core/db";
import { agentTaskQueue } from "@/server/core/jobs";
import { acceptInvitation, createOrganization, inviteMember } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { systemRoleId } from "@/server/modules/rbac/service";
import { createTask, processAgentTask } from "@/server/modules/agents/service";
import { setModelForTests } from "@/server/modules/agents/runtime";
import { decideApproval, expireApprovals, listApprovals } from "@/server/modules/approvals/service";
import { createObjective, listObjectives } from "@/server/modules/objectives/service";
import { getGraph } from "@/server/modules/graph/service";
import { expectCode, makeUser, resetDb } from "../helpers";

beforeAll(resetDb);
afterEach(() => setModelForTests(null));
afterAll(async () => {
  await agentTaskQueue().obliterate({ force: true });
});

/** Scripted model: first proposes one tool call, then finishes. */
function proposes(name: string, input: object) {
  let n = 0;
  setModelForTests(async () => {
    n++;
    const base = { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 } };
    return (n === 1
      ? { ...base, stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name, input }] }
      : { ...base, stop_reason: "end_turn", content: [{ type: "text", text: "Done; one action awaits approval.", citations: null }] }) as unknown as BetaMessage;
  });
}

async function setup() {
  const owner = await makeUser();
  const org = await createOrganization(owner.ctx, { name: `Approvals ${Math.random()}` });
  const company = await createCompany(owner.ctx, org.id, { name: "Approve Co" });
  return { owner, org, company };
}

describe("approvals for supervised AI actions", () => {
  it("a supervised tool call files a request and changes nothing; approval runs it as the approver, exactly once", async () => {
    const { owner, org, company } = await setup();
    proposes("create_graph_entity", { kind: "CUSTOMER", name: "Emirates Retail" });
    const task = await createTask(owner.ctx, org.id, company.id, { profile: "sales_researcher", title: "Find accounts", instructions: "x" });
    expect(await processAgentTask(task.id, `${task.id}_1`, { finalAttempt: true })).toBe("completed");

    expect((await getGraph(owner.ctx, org.id, company.id)).entities).toHaveLength(0); // nothing happened yet
    const [req] = await listApprovals(owner.ctx, org.id, company.id, { status: "PENDING" });
    expect(req).toMatchObject({ tool: "create_graph_entity", risk: "MEDIUM", autonomy: "SUPERVISED", taskId: task.id, requestedByProfile: "sales_researcher", requiredPermissions: ["graph.manage"] });
    expect((await db().agentTask.findUniqueOrThrow({ where: { id: task.id } })).toolCalls).toEqual([expect.objectContaining({ tool: "create_graph_entity", approvalId: req!.id })]);

    expect(await decideApproval(owner.ctx, org.id, company.id, req!.id, { decision: "approve", note: "Good lead" })).toMatchObject({ status: "EXECUTED" });
    expect((await getGraph(owner.ctx, org.id, company.id)).entities.map((e) => e.name)).toEqual(["Emirates Retail"]);
    await expectCode(decideApproval(owner.ctx, org.id, company.id, req!.id, { decision: "approve" }), "conflict"); // never twice
    const audit = (await db().auditLog.findMany({ where: { resourceId: req!.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(audit).toEqual(["approval.requested", "approval.executed"]);
  });

  it("rejection, expiry, approver permissions and tenant isolation", async () => {
    const { owner, org, company } = await setup();
    const objective = await createObjective(owner.ctx, org.id, company.id, { title: "First 100 customers" });
    proposes("create_milestone", { objectiveId: objective.id, title: "10 pilot customers" });
    const task = await createTask(owner.ctx, org.id, company.id, { profile: "operations_assistant", title: "Plan", instructions: "x" });
    await processAgentTask(task.id, `${task.id}_1`, { finalAttempt: true });
    const [req] = await listApprovals(owner.ctx, org.id, company.id, { status: "PENDING" });

    // A member can see requests but not decide; another tenant can't see them at all.
    const member = await makeUser();
    const { token } = await inviteMember(owner.ctx, org.id, { email: member.user.email, roleId: await systemRoleId(db(), "MEMBER"), scopeType: "COMPANY", scopeId: company.id });
    await acceptInvitation(member.ctx, token);
    expect(await listApprovals(member.ctx, org.id, company.id)).toHaveLength(1);
    await expectCode(decideApproval(member.ctx, org.id, company.id, req!.id, { decision: "approve" }), "forbidden");
    const other = await setup();
    await expectCode(decideApproval(other.owner.ctx, other.org.id, other.company.id, req!.id, { decision: "approve" }), "not_found");

    expect(await decideApproval(owner.ctx, org.id, company.id, req!.id, { decision: "reject", note: "Not now" })).toMatchObject({ status: "REJECTED" });
    expect((await listObjectives(owner.ctx, org.id, company.id))[0]!.milestones).toHaveLength(0);

    // Expired requests can't be approved.
    proposes("create_milestone", { objectiveId: objective.id, title: "Late" });
    const t2 = await createTask(owner.ctx, org.id, company.id, { profile: "operations_assistant", title: "Plan 2", instructions: "x" });
    await processAgentTask(t2.id, `${t2.id}_1`, { finalAttempt: true });
    const [late] = await listApprovals(owner.ctx, org.id, company.id, { status: "PENDING" });
    await db().approval.update({ where: { id: late!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expectCode(decideApproval(owner.ctx, org.id, company.id, late!.id, { decision: "approve" }), "conflict");
    expect(await expireApprovals()).toBeGreaterThanOrEqual(0);
    expect((await db().approval.findUniqueOrThrow({ where: { id: late!.id } })).status).toBe("EXPIRED");
  });

  it("an agent can't use a tool outside its allow-list, even if the requester could", async () => {
    const { owner, org, company } = await setup();
    proposes("create_project", { name: "Sneaky" }); // research_analyst has read tools only
    const task = await createTask(owner.ctx, org.id, company.id, { profile: "research_analyst", title: "Read", instructions: "x" });
    await processAgentTask(task.id, `${task.id}_1`, { finalAttempt: true });
    expect(await listApprovals(owner.ctx, org.id, company.id)).toHaveLength(0);
    expect((await db().agentTask.findUniqueOrThrow({ where: { id: task.id } })).toolCalls).toEqual([expect.objectContaining({ tool: "create_project", error: "Tool create_project is not available to this role" })]);
  });
});
