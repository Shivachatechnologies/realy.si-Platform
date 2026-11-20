import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask, MAX_DELEGATION_DEPTH } from "@/server/modules/agents/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { budgetRefusal, employeeBudget } from "./budgets";
import { chainFounderIds } from "./hierarchy";

/**
 * Bounded delegation. A manager agent can hand sub-tasks to its reports with delegate_to_ai_employee; these limits keep
 * a confused agent from fanning out work or spending without bound:
 *   - depth: at most MAX_DELEGATION_DEPTH levels below the person's task (agents/service.ts),
 *   - fan-out: at most MAX_DELEGATIONS_PER_TASK sub-tasks (created + proposed) per task,
 *   - tree size: at most MAX_TASKS_PER_TREE delegated tasks under one top-level task,
 *   - budget: the receiving employee (and its department) must have allowance left; the runtime caps each run.
 * Supervised employees only *propose* (AiDelegation, PROPOSED); a person with agents.manage approves it and the sub-task
 * is created with that person as principal — never with more permissions than they hold.
 */
export const MAX_DELEGATIONS_PER_TASK = 4;
export const MAX_TASKS_PER_TREE = 12;
/** Proposals nobody decided within this time are closed (the parent task's context is stale by then). */
export const PROPOSAL_TTL_MS = 72 * 60 * 60_000;

/** The top-level task of a delegation tree (walks parentTaskId; depth is bounded). */
async function rootTaskId(organizationId: string, companyId: string, taskId: string) {
  let cursor = taskId;
  for (let i = 0; i <= MAX_DELEGATION_DEPTH + 1; i++) {
    const t = await db().agentTask.findFirst({ where: { id: cursor, organizationId, companyId }, select: { parentTaskId: true } });
    if (!t?.parentTaskId) return cursor;
    cursor = t.parentTaskId;
  }
  return cursor;
}

/** Plain-language reason why another delegation from this task is not allowed, or null. */
export async function delegationLimitReason(organizationId: string, companyId: string, parentTaskId: string): Promise<string | null> {
  const parent = await db().agentTask.findFirst({ where: { id: parentTaskId, organizationId, companyId }, select: { depth: true } });
  if (!parent) return "The delegating task no longer exists.";
  if (parent.depth + 1 > MAX_DELEGATION_DEPTH) return `Delegation is limited to ${MAX_DELEGATION_DEPTH} levels; do this part yourself or escalate it.`;
  const [children, proposals] = await Promise.all([
    db().agentTask.count({ where: { organizationId, companyId, parentTaskId } }),
    db().aiDelegation.count({ where: { organizationId, companyId, parentTaskId, status: "PROPOSED" } }),
  ]);
  if (children + proposals >= MAX_DELEGATIONS_PER_TASK) return `This task already handed out ${MAX_DELEGATIONS_PER_TASK} sub-tasks (the limit); finish with what you have.`;
  const root = await rootTaskId(organizationId, companyId, parentTaskId);
  const level1 = await db().agentTask.findMany({ where: { organizationId, companyId, parentTaskId: root }, select: { id: true }, take: 100 });
  const level2 = level1.length ? await db().agentTask.count({ where: { organizationId, companyId, parentTaskId: { in: level1.map((t) => t.id) } } }) : 0;
  if (level1.length + level2 >= MAX_TASKS_PER_TREE) return `This piece of work already has ${MAX_TASKS_PER_TREE} delegated tasks (the limit); finish with what you have.`;
  return null;
}

/** Plain-language reason why an employee cannot take delegated work now (missing, paused, over budget), or null. */
export async function receiverUnavailableReason(organizationId: string, companyId: string, employeeId: string): Promise<string | null> {
  const e = await db().aiEmployee.findFirst({
    where: { id: employeeId, organizationId, companyId, archivedAt: null },
    select: { id: true, name: true, status: true, department: true, model: true, monthlyTokenBudget: true, monthlyCostBudgetCents: true },
  });
  if (!e) return "That AI employee does not exist in this company (see read_ai_employees).";
  if (e.status === "PAUSED") return `${e.name} is paused and cannot take work.`;
  const r = budgetRefusal(e.name, await employeeBudget(organizationId, companyId, e));
  return r ? `${r.message}; choose someone else or escalate.` : null;
}

/** File a delegation proposal and notify the people who manage the AI workforce. */
export async function proposeDelegation(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  input: { parentTaskId: string; fromEmployeeId: string; fromName: string; toEmployeeId: string; title: string; instructions: string },
) {
  const recipients = await chainFounderIds(organizationId, companyId, input.fromEmployeeId);
  return transaction(async (tx) => {
    const d = await tx.aiDelegation.create({
      data: { organizationId, companyId, parentTaskId: input.parentTaskId, fromEmployeeId: input.fromEmployeeId, toEmployeeId: input.toEmployeeId, title: input.title, instructions: input.instructions },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "ai_delegation.proposed",
      resourceType: "ai_delegation",
      resourceId: d.id,
      newValue: { companyId, parentTaskId: input.parentTaskId, fromEmployeeId: input.fromEmployeeId, toEmployeeId: input.toEmployeeId, title: input.title },
    });
    await notifyUsers(tx, organizationId, recipients, "workforce.delegationProposed", { companyId, title: `${input.fromName}: ${input.title}`.slice(0, 200), href: "/workforce/escalations#delegations" });
    return d;
  });
}

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "agents.read" | "agents.manage", tx?: Tx) {
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), organizationId, companyId), tx);
}

export const delegationFilters = z.object({ status: z.enum(["PROPOSED", "CREATED", "REJECTED", "FAILED"]).optional().catch(undefined) });

export async function listDelegations(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, unknown> = {}, take = 50) {
  const f = delegationFilters.parse(raw);
  await authorize(ctx, organizationId, companyId, "agents.read");
  return db().aiDelegation.findMany({
    where: { organizationId, companyId, ...(f.status ? { status: f.status } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      fromEmployee: { select: { id: true, name: true, initials: true, department: true } },
      toEmployee: { select: { id: true, name: true, initials: true, department: true, status: true } },
    },
  });
}

export const decideDelegationInput = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).optional() });

/**
 * Approve (create the sub-task, linked to the proposing task) or reject a proposal. The claim (PROPOSED → CREATED) makes
 * concurrent decisions safe; if the sub-task cannot be created (paused employee, budget, limits, platform controls)
 * the proposal returns to PROPOSED and the reason is returned to the person.
 */
export async function decideDelegation(ctx: RequestContext, organizationId: string, companyId: string, delegationId: string, raw: z.input<typeof decideDelegationInput>) {
  const input = decideDelegationInput.parse(raw);
  if (!z.string().uuid().safeParse(delegationId).success) throw notFound("Delegation");
  await authorize(ctx, organizationId, companyId, "agents.manage");
  const d = await db().aiDelegation.findFirst({ where: { id: delegationId, organizationId, companyId } });
  if (!d) throw notFound("Delegation");
  if (d.status !== "PROPOSED") throw conflict(`This delegation is already ${d.status.toLowerCase()}`, { reason: "workforce_delegation_decided" });
  const decided = { decidedById: ctx.actor.id ?? null, decidedAt: new Date(), decisionNote: input.note || null };

  if (input.decision === "reject") {
    return transaction(async (tx) => {
      const { count } = await tx.aiDelegation.updateMany({ where: { id: d.id, status: "PROPOSED" }, data: { status: "REJECTED", ...decided } });
      if (!count) throw conflict("Someone else decided this delegation", { reason: "workforce_delegation_decided" });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ai_delegation.rejected", resourceType: "ai_delegation", resourceId: d.id, newValue: { companyId, note: input.note ?? null } });
      return { id: d.id, status: "REJECTED" as const, taskId: null };
    });
  }

  // Limits are re-checked at decision time: other sub-tasks may have been created meanwhile (this proposal itself
  // still counts as PROPOSED, so the fan-out check allows exactly its own slot).
  const parent = await db().agentTask.findFirst({ where: { id: d.parentTaskId, organizationId, companyId }, select: { depth: true } });
  if (!parent) throw conflict("The task that proposed this delegation no longer exists; reject it", { reason: "workforce_delegation_parent_missing" });
  const created = await db().agentTask.count({ where: { organizationId, companyId, parentTaskId: d.parentTaskId } });
  if (created >= MAX_DELEGATIONS_PER_TASK) throw conflict(`The proposing task already has ${MAX_DELEGATIONS_PER_TASK} sub-tasks`, { reason: "workforce_delegation_limit" });

  const { count } = await db().aiDelegation.updateMany({ where: { id: d.id, status: "PROPOSED" }, data: { status: "CREATED", ...decided } });
  if (!count) throw conflict("Someone else decided this delegation", { reason: "workforce_delegation_decided" });
  try {
    const from = await db().aiEmployee.findFirst({ where: { id: d.fromEmployeeId, companyId }, select: { name: true } });
    const task = await createTask(
      ctx,
      organizationId,
      companyId,
      {
        aiEmployeeId: d.toEmployeeId,
        title: d.title,
        instructions: `${from?.name ?? "Your manager"} delegated this to you (approved by a person).\n\n${d.instructions}`,
        subject: { type: "ai_delegation", id: d.id },
      },
      { parentTaskId: d.parentTaskId },
    );
    await transaction(async (tx) => {
      await tx.aiDelegation.update({ where: { id: d.id }, data: { childTaskId: task.id } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ai_delegation.approved", resourceType: "ai_delegation", resourceId: d.id, newValue: { companyId, taskId: task.id, note: input.note ?? null } });
    });
    return { id: d.id, status: "CREATED" as const, taskId: task.id };
  } catch (err) {
    // Not created (paused, budget, limits, platform controls): back to PROPOSED so the person can retry or reject.
    await db().aiDelegation.updateMany({ where: { id: d.id, status: "CREATED", childTaskId: null }, data: { status: "PROPOSED", decidedById: null, decidedAt: null, decisionNote: null } });
    throw err;
  }
}

/** Worker: proposals left undecided past PROPOSAL_TTL_MS are closed as rejected (stated as expired). */
export async function expireDelegationProposals(): Promise<number> {
  const { count } = await db().aiDelegation.updateMany({
    where: { status: "PROPOSED", createdAt: { lt: new Date(Date.now() - PROPOSAL_TTL_MS) } },
    data: { status: "REJECTED", decidedAt: new Date(), decisionNote: "Expired: nobody decided within 72 hours" },
  });
  return count;
}
