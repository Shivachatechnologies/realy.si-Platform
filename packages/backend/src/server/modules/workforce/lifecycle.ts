import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, forbidden, invalid, isAppError, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { resolveProfile } from "@/server/modules/agents/role-profiles";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";
import { getTool, loadTools } from "@/server/modules/tools/registry";
import { assertFeature, assertLimit } from "@/server/modules/entitlements/service";
import { AUTONOMY_LEVELS } from "./autonomy";
import { workforcePerformance } from "./performance";
import { archiveEmployee, createEmployee, DEPARTMENTS, getEmployee, ORG_LEVELS, reassignAiTask, setEmployeeStatus, updateEmployee, workingHoursOf } from "./service";

/**
 * Lifecycle of an AI employee — every action is permission-checked (agents.manage) and audited:
 * provision (createEmployee / the organization designer), assign, promote, change role, change manager, change
 * permissions (only ever narrowed to what the requester holds), pause / resume, evaluate, replace (queue transferred)
 * and retire (archived; tasks, reports and audit history stay).
 */

const uuid = z.string().uuid();
const RANK = { SPECIALIST: 0, MANAGER: 1, EXECUTIVE: 2 } as const;

export const lifecycleInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), department: z.enum(DEPARTMENTS), managerEmployeeId: uuid.nullable().optional(), managerUserId: uuid.nullable().optional() }),
  z.object({ action: z.literal("promote"), level: z.enum(["MANAGER", "EXECUTIVE"]), jobTitle: z.string().trim().max(120).nullable().optional() }),
  z.object({ action: z.literal("change_role"), profileKey: z.string().regex(/^[a-z_]{2,60}$/), level: z.enum(ORG_LEVELS).optional(), jobTitle: z.string().trim().max(120).nullable().optional() }),
  z.object({ action: z.literal("change_manager"), managerEmployeeId: uuid.nullable().optional(), managerUserId: uuid.nullable().optional() }),
  z.object({ action: z.literal("change_permissions"), allowedTools: z.array(z.string().regex(/^[a-z0-9_]{2,60}$/)).max(60).optional(), autonomy: z.enum(AUTONOMY_LEVELS).optional(), runsAsUserId: uuid.nullable().optional() }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("evaluate"), days: z.number().int().min(7).max(90).optional() }),
  z.object({ action: z.literal("replace"), replacementEmployeeId: uuid.optional(), name: z.string().trim().min(1).max(80).optional() }),
  z.object({ action: z.literal("retire"), reason: z.string().trim().max(500).optional() }),
]);
export type LifecycleInput = z.input<typeof lifecycleInput>;

async function authorize(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "agents.manage", chain);
  return chain;
}

async function audit(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, action: string, newValue: Record<string, unknown>, oldValue?: Record<string, unknown>) {
  await transaction((tx) =>
    writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `ai_employee.${action}`, resourceType: "ai_employee", resourceId: employeeId, ...(oldValue ? { oldValue: oldValue as Prisma.InputJsonValue } : {}), newValue: { companyId, ...newValue } as Prisma.InputJsonValue }),
  );
}

/**
 * Permissions may only be narrowed below the requester's own: every tool the employee would be offered must be one
 * whose permissions the requester holds, and the employee may only run as the requester (or as whoever assigns
 * each task). "All tools" counts as every tool of the role.
 */
export async function assertWithinOwnPermissions(ctx: RequestContext, chain: ScopeChain, profileTools: readonly string[], allowedTools: string[], runsAsUserId: string | null | undefined, currentRunsAs: string | null) {
  await loadTools();
  const effective = allowedTools.length ? allowedTools : [...profileTools];
  const cache = new Map<string, boolean>();
  const denied: string[] = [];
  for (const name of effective) {
    const d = getTool(name);
    if (!d) continue;
    for (const p of d.permissions) {
      if (!cache.has(p)) cache.set(p, await can(ctx, p, chain).catch(() => false));
      if (!cache.get(p)) {
        denied.push(name);
        break;
      }
    }
  }
  if (denied.length) throw forbidden("You can only give an AI employee permissions you hold yourself", { reason: "workforce_permission_exceeds_own", tools: denied.slice(0, 20) });
  if (runsAsUserId && runsAsUserId !== currentRunsAs && runsAsUserId !== ctx.actor.id) throw forbidden("An AI employee can only run with your own permissions", { reason: "workforce_runs_as_not_self" });
}

export interface Evaluation {
  score: number | null;
  verdict: "strong" | "steady" | "needs_attention" | "insufficient_data";
  days: number;
  completed: number;
  failed: number;
  successRate: number | null;
  approvalRate: number | null;
  escalationsOpen: number;
  costMicros: number;
  kpiCount: number;
  at: string;
}

/** Deterministic evaluation from real task, approval and escalation data (no AI involved). */
export function scoreEvaluation(s: { completed: number; failed: number; successRate: number | null; approvalsRequested: number; approvalsApproved: number; escalationsOpen: number; costMicros: number }, days: number, kpiCount: number): Evaluation {
  const finished = s.completed + s.failed;
  const approvalRate = s.approvalsRequested ? s.approvalsApproved / s.approvalsRequested : null;
  const base = { days, completed: s.completed, failed: s.failed, successRate: s.successRate, approvalRate, escalationsOpen: s.escalationsOpen, costMicros: s.costMicros, kpiCount, at: new Date().toISOString() };
  if (finished < 3 || s.successRate === null) return { ...base, score: null, verdict: "insufficient_data" };
  const score = Math.round(100 * (0.6 * s.successRate + 0.25 * (approvalRate ?? s.successRate) + 0.15 * (1 - Math.min(1, s.escalationsOpen / 3))));
  return { ...base, score, verdict: score >= 80 ? "strong" : score >= 60 ? "steady" : "needs_attention" };
}

export async function runLifecycleAction(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, raw: LifecycleInput) {
  const input = lifecycleInput.parse(raw);
  const chain = await authorize(ctx, organizationId, companyId);
  const e = await getEmployee(ctx, organizationId, companyId, employeeId);
  switch (input.action) {
    case "assign": {
      const out = await updateEmployee(ctx, organizationId, companyId, employeeId, {
        department: input.department,
        ...(input.managerEmployeeId !== undefined ? { managerEmployeeId: input.managerEmployeeId } : {}),
        ...(input.managerUserId !== undefined ? { managerUserId: input.managerUserId } : {}),
      });
      await audit(ctx, organizationId, companyId, employeeId, "assigned", { department: input.department, managerEmployeeId: out.managerEmployeeId, managerUserId: out.managerUserId }, { department: e.department });
      return out;
    }
    case "promote": {
      if (RANK[input.level] <= RANK[e.level]) throw conflict("A promotion must raise the level", { reason: "workforce_promotion_not_higher" });
      await assertFeature(ctx, organizationId, "feature.executive_team");
      const out = await updateEmployee(ctx, organizationId, companyId, employeeId, { level: input.level, ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}) });
      await audit(ctx, organizationId, companyId, employeeId, "promoted", { level: input.level }, { level: e.level });
      return out;
    }
    case "change_role": {
      if (!(await resolveProfile({ organizationId, companyId }, input.profileKey))) throw notFound("Profile");
      if (input.profileKey === e.profileKey && !input.level && input.jobTitle === undefined) throw conflict("This is already the employee's role", { reason: "workforce_role_unchanged" });
      const out = await updateEmployee(ctx, organizationId, companyId, employeeId, { profileKey: input.profileKey, ...(input.level ? { level: input.level } : {}), ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}) });
      await audit(ctx, organizationId, companyId, employeeId, "role_changed", { profileKey: out.profileKey, level: out.level }, { profileKey: e.profileKey, level: e.level });
      return out;
    }
    case "change_manager": {
      if (!input.managerEmployeeId && !input.managerUserId) throw invalid("Choose an AI manager or a person", { reason: "workforce_manager_required" });
      // Cycle and validity checks run in updateEmployee (checkManager walks the chain).
      const out = await updateEmployee(ctx, organizationId, companyId, employeeId, input.managerEmployeeId ? { managerEmployeeId: input.managerEmployeeId } : { managerUserId: input.managerUserId! });
      await audit(ctx, organizationId, companyId, employeeId, "manager_changed", { managerEmployeeId: out.managerEmployeeId, managerUserId: out.managerUserId }, { managerEmployeeId: e.managerEmployeeId, managerUserId: e.managerUserId });
      return out;
    }
    case "change_permissions": {
      const profile = await resolveProfile({ organizationId, companyId }, e.profileKey);
      if (!profile) throw notFound("Profile");
      const allowedTools = input.allowedTools ?? e.allowedTools;
      await assertWithinOwnPermissions(ctx, chain, profile.tools, allowedTools, input.runsAsUserId, e.runsAsUserId);
      const out = await updateEmployee(ctx, organizationId, companyId, employeeId, {
        ...(input.allowedTools !== undefined ? { allowedTools: input.allowedTools } : {}),
        ...(input.autonomy !== undefined ? { autonomy: input.autonomy } : {}),
        ...(input.runsAsUserId !== undefined ? { runsAsUserId: input.runsAsUserId } : {}),
      });
      await audit(ctx, organizationId, companyId, employeeId, "permissions_changed", { allowedTools: out.allowedTools, autonomy: out.autonomy, runsAsUserId: out.runsAsUserId }, { allowedTools: e.allowedTools, autonomy: e.autonomy, runsAsUserId: e.runsAsUserId });
      return out;
    }
    case "pause":
    case "resume":
      return setEmployeeStatus(ctx, organizationId, companyId, employeeId, { status: input.action === "pause" ? "PAUSED" : "ACTIVE" });
    case "evaluate": {
      const days = input.days ?? 30;
      const perf = await workforcePerformance(organizationId, companyId, [e], days);
      const s = perf.byEmployee.get(e.id)!;
      const kpis = Array.isArray(e.kpis) ? e.kpis.length : 0;
      const evaluation = scoreEvaluation(s, days, kpis);
      await transaction(async (tx) => {
        await tx.aiEmployee.update({ where: { id: e.id }, data: { lastEvaluation: evaluation as unknown as Prisma.InputJsonValue, lastEvaluatedAt: new Date() } });
        await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ai_employee.evaluated", resourceType: "ai_employee", resourceId: e.id, newValue: { companyId, score: evaluation.score, verdict: evaluation.verdict, days } });
      });
      return evaluation;
    }
    case "replace":
      return replaceEmployee(ctx, organizationId, companyId, e, input);
    case "retire": {
      const out = await archiveEmployee(ctx, organizationId, companyId, employeeId);
      await audit(ctx, organizationId, companyId, employeeId, "retired", { reason: input.reason ?? null });
      return out;
    }
  }
}

type Employee = Awaited<ReturnType<typeof getEmployee>>;

/**
 * Replace: a successor (an existing employee, or a new hire with the same role, settings and reporting line) takes
 * over the queue (queued tasks are moved), the direct reports and the schedules; the old employee is retired.
 */
async function replaceEmployee(ctx: RequestContext, organizationId: string, companyId: string, e: Employee, input: { replacementEmployeeId?: string; name?: string }) {
  let successorId = input.replacementEmployeeId ?? null;
  if (successorId === e.id) throw invalid("An AI employee cannot replace itself", { reason: "workforce_replace_self" });
  if (successorId) {
    const s = await db().aiEmployee.findFirst({ where: { id: successorId, organizationId, companyId, archivedAt: null }, select: { id: true } });
    if (!s) throw notFound("AI employee");
  } else {
    await assertLimit(ctx, organizationId, "agents.max", 1);
    const created = await createEmployee(
      ctx,
      organizationId,
      companyId,
      {
        profileKey: e.profileKey,
        name: input.name ?? `${e.name} (successor)`.slice(0, 80),
        instructions: e.instructions,
        skills: e.skills,
        allowedTools: e.allowedTools,
        autonomy: e.autonomy,
        monthlyTokenBudget: e.monthlyTokenBudget,
        monthlyCostBudgetCents: e.monthlyCostBudgetCents === null ? null : Number(e.monthlyCostBudgetCents),
        ...(e.managerEmployeeId ? { managerEmployeeId: e.managerEmployeeId } : e.managerUserId ? { managerUserId: e.managerUserId } : {}),
        level: e.level,
        jobTitle: e.jobTitle,
        jobDescription: e.jobDescription,
        responsibilities: e.responsibilities,
        goals: e.goals,
        kpis: Array.isArray(e.kpis) ? (e.kpis as { key: string; target: number }[]) : [],
        model: e.model,
        personality: e.personality,
        communicationStyle: e.communicationStyle,
        timezone: e.timezone,
        workingHours: workingHoursOf(e.workingHours),
      },
      { department: e.department as (typeof DEPARTMENTS)[number] },
    );
    successorId = created.id;
  }
  // Queue transfer: queued tasks are re-created for the successor (agents service checks apply); the rest stays as history.
  const queued = await db().agentTask.findMany({ where: { organizationId, companyId, aiEmployeeId: e.id, status: "QUEUED" }, select: { id: true }, take: 200 });
  let moved = 0;
  const failed: string[] = [];
  for (const t of queued) {
    try {
      await reassignAiTask(ctx, organizationId, companyId, t.id, { aiEmployeeId: successorId });
      moved++;
    } catch {
      failed.push(t.id);
    }
  }
  await transaction(async (tx) => {
    await tx.aiEmployee.updateMany({ where: { managerEmployeeId: e.id, companyId, archivedAt: null, id: { not: successorId! } }, data: { managerEmployeeId: successorId } });
    await tx.aiSchedule.updateMany({ where: { aiEmployeeId: e.id, companyId }, data: { aiEmployeeId: successorId! } });
    await tx.aiEmployee.update({ where: { id: e.id }, data: { replacedByEmployeeId: successorId } });
  });
  await archiveEmployee(ctx, organizationId, companyId, e.id);
  await audit(ctx, organizationId, companyId, e.id, "replaced", { successorId, movedTasks: moved, failedTasks: failed.length });
  return { id: successorId, successorId, movedTasks: moved, failedTasks: failed };
}

/** Work history: the employee's audited lifecycle (newest first). */
export async function workHistory(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, take = 50) {
  await getEmployee(ctx, organizationId, companyId, employeeId).catch(async (err) => {
    // Retired employees keep their history: allow reading archived ones too.
    if (!isAppError(err) || err.code !== "not_found" || !(await db().aiEmployee.count({ where: { id: employeeId, organizationId, companyId } }))) throw err;
  });
  const rows = await db().auditLog.findMany({
    where: { organizationId, resourceType: "ai_employee", resourceId: employeeId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, actorType: true, actorId: true, createdAt: true, newValue: true },
  });
  const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
  const users = actorIds.length ? await db().user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, action: r.action.replace(/^ai_employee\./, ""), actor: r.actorId ? (names.get(r.actorId) ?? null) : null, actorType: r.actorType, at: r.createdAt }));
}
