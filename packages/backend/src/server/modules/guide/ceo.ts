import "server-only";
import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { isoWeekKey } from "@/server/modules/growth/signals";
import { dayBounds } from "@/server/modules/objectives/overview";
import { planObjective } from "@/server/modules/objectives/execution";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { MAX_RUNS_PER_DAY, runCeoCycle } from "./ceo-loop";
import { startDelegatedRun } from "./command-delegate";
import { cancelRun } from "./command-run";
import { isUuid } from "./pages";

/** The AI CEO page: this week's priorities, what the CEO delegated and why, outcomes, decisions for the founder. */

export const decisionInput = z.object({ decision: z.enum(["approve", "dismiss"]), note: z.string().trim().max(1000).optional() });
export const priorityStatusInput = z.object({ status: z.enum(["ACTIVE", "DROPPED"]) });

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "agents.read" | "agents.manage") {
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain);
  return chain;
}

export async function ceoOverview(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "agents.read");
  const scope = { organizationId, companyId };
  const weekKey = isoWeekKey();
  const company = await db().company.findFirst({ where: { id: companyId, organizationId }, select: { timezone: true, baseCurrency: true } });
  const { start } = dayBounds(company?.timezone ?? "UTC");
  const [ceo, cycles, priorities, actions, decisions, outcomes, pendingApprovals, usedRuns, usedReplans, canManage, canRun, canApprove] = await Promise.all([
    db().aiEmployee.findFirst({ where: { ...scope, profileKey: "ai_ceo", archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, status: true, autonomy: true } }),
    db().ceoCycle.findMany({ where: scope, orderBy: { day: "desc" }, take: 7 }),
    db().ceoPriority.findMany({ where: { ...scope, weekKey }, orderBy: [{ status: "asc" }, { score: "desc" }], take: 20 }),
    db().ceoAction.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 40 }),
    db().ceoDecision.findMany({ where: scope, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 30 }),
    db().commandRun.findMany({
      where: { ...scope, origin: "CEO", status: { in: ["COMPLETED", "FAILED"] } },
      orderBy: { completedAt: "desc" },
      take: 12,
      select: { id: true, sessionId: true, userId: true, text: true, status: true, nextAction: true, documentId: true, documentError: true, priorityId: true, completedAt: true, steps: { select: { profile: true, aiEmployeeId: true }, take: 3 } },
    }),
    db().approval.count({ where: { ...scope, status: "PENDING", expiresAt: { gt: new Date() } } }),
    db().commandRun.count({ where: { ...scope, origin: "CEO", createdAt: { gte: start } } }),
    db().ceoAction.count({ where: { ...scope, kind: "REPLANNED", createdAt: { gte: start } } }),
    can(ctx, "agents.manage", chain),
    can(ctx, "agents.run", chain),
    can(ctx, "approvals.decide", chain),
  ]);
  const runIds = [...new Set([...priorities.map((p) => p.commandRunId), ...actions.map((a) => a.commandRunId)].filter((v): v is string => !!v))];
  const taskIds = actions.map((a) => a.taskId).filter((v): v is string => !!v);
  const [runs, tasks] = await Promise.all([
    runIds.length ? db().commandRun.findMany({ where: { ...scope, id: { in: runIds } }, select: { id: true, sessionId: true, userId: true, status: true, nextAction: true, documentId: true } }) : [],
    taskIds.length ? db().agentTask.findMany({ where: { ...scope, id: { in: taskIds } }, select: { id: true, status: true } }) : [],
  ]);
  const me = ctx.actor.id;
  const runOf = new Map(runs.map((r) => [r.id, { id: r.id, status: r.status as string, nextAction: r.nextAction, documentId: r.documentId, sessionId: r.userId === me ? r.sessionId : null }]));
  const taskOf = new Map(tasks.map((x) => [x.id, x.status as string]));
  const titleOf = new Map(priorities.map((p) => [p.id, p.title]));
  const last = cycles[0] ?? null;
  return {
    weekKey,
    currency: company?.baseCurrency ?? "USD",
    ai: { configured: aiConfigured() },
    ceo,
    cycle: last
      ? { id: last.id, day: last.day, status: last.status as string, trigger: last.trigger, skippedReason: last.skippedReason, review: last.review as Record<string, number | string | null>, delegated: last.delegated, followedUp: last.followedUp, escalated: last.escalated, startedAt: last.startedAt, completedAt: last.completedAt }
      : null,
    history: cycles.map((c) => ({ day: c.day, status: c.status as string, delegated: c.delegated, followedUp: c.followedUp, escalated: c.escalated, skippedReason: c.skippedReason })),
    caps: { perDay: MAX_RUNS_PER_DAY, usedToday: usedRuns + usedReplans },
    pendingApprovals,
    priorities: priorities.map((p) => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      rationale: p.rationale,
      params: p.params as Record<string, string | number>,
      href: p.href,
      profile: p.profile,
      status: p.status as string,
      score: p.score,
      attempts: p.attempts,
      lastDelegatedAt: p.lastDelegatedAt,
      run: p.commandRunId ? (runOf.get(p.commandRunId) ?? null) : null,
    })),
    actions: actions.map((a) => ({
      id: a.id,
      kind: a.kind as string,
      reason: a.reason,
      params: a.params as Record<string, string | number>,
      profile: a.profile,
      priorityId: a.priorityId,
      priority: a.priorityId ? (titleOf.get(a.priorityId) ?? null) : null,
      run: a.commandRunId ? (runOf.get(a.commandRunId) ?? null) : null,
      taskId: a.taskId,
      taskStatus: a.taskId ? (taskOf.get(a.taskId) ?? null) : null,
      createdAt: a.createdAt,
    })),
    decisions: decisions.map((d) => ({ id: d.id, kind: d.kind, title: d.title, params: d.params as Record<string, string | number>, href: d.href, status: d.status as string, priorityId: d.priorityId, hasProposal: !!d.proposal, note: d.note, createdAt: d.createdAt, resolvedAt: d.resolvedAt, commandRunId: d.commandRunId })),
    outcomes: outcomes.map((r) => ({
      id: r.id,
      text: r.text,
      status: r.status as string,
      nextAction: r.nextAction,
      documentId: r.documentId,
      documentError: r.documentError,
      priorityId: r.priorityId,
      priority: r.priorityId ? (titleOf.get(r.priorityId) ?? null) : null,
      profiles: [...new Set(r.steps.map((s) => s.profile))],
      sessionId: r.userId === me ? r.sessionId : null,
      completedAt: r.completedAt,
    })),
    canManage,
    canRun,
    canApprove,
  };
}
export type CeoOverview = Awaited<ReturnType<typeof ceoOverview>>;

/** "Run the CEO review now" (agents.manage): today's cycle acting as the viewer, within the same daily caps. */
export async function runCeoNow(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "agents.manage");
  if (!ctx.actor.id) throw notFound("Member");
  return runCeoCycle({ organizationId, companyId }, { trigger: "manual", actingUserId: ctx.actor.id });
}

/** The founder decides on something the AI CEO escalated; approving a delegation proposal starts the run. */
export async function decideCeoDecision(ctx: RequestContext, organizationId: string, companyId: string, decisionId: string, raw: z.input<typeof decisionInput>) {
  const input = decisionInput.parse(raw);
  const chain = await authorize(ctx, organizationId, companyId, "agents.manage");
  if (!isUuid(decisionId)) throw notFound("Decision");
  const scope = { organizationId, companyId };
  const d = await db().ceoDecision.findFirst({ where: { ...scope, id: decisionId } });
  if (!d) throw notFound("Decision");
  if (d.status !== "OPEN") throw conflict("This decision is already closed", { reason: "ceo_decision_closed" });
  const claimed = await db().ceoDecision.updateMany({ where: { id: d.id, status: "OPEN" }, data: { status: input.decision === "approve" ? "APPROVED" : "DISMISSED", resolvedById: ctx.actor.id ?? null, resolvedAt: new Date(), note: input.note ?? null } });
  if (!claimed.count) throw conflict("This decision is already closed", { reason: "ceo_decision_closed" });
  let commandRunId: string | null = null;
  if (input.decision === "approve" && ctx.actor.id) {
    try {
      if (d.kind === "delegation_proposal" && d.proposal) {
        await requirePermission(ctx, "agents.run", chain);
        const p = d.proposal as { profile: string; text: string; brief: string; priorityId: string | null };
        const company = await db().company.findFirst({ where: { id: companyId, organizationId }, select: { defaultLocale: true } });
        const priority = p.priorityId ? await db().ceoPriority.findFirst({ where: { ...scope, id: p.priorityId }, select: { id: true, objectiveId: true, commandRunId: true } }) : null;
        const started = await startDelegatedRun(ctx, scope, { userId: ctx.actor.id, origin: "CEO", profile: p.profile, text: p.text, brief: `${p.brief} The founder approved this delegation.`, priorityId: priority?.id ?? null, objectiveId: priority?.objectiveId ?? null, parentRunId: priority?.commandRunId ?? null, locale: company?.defaultLocale });
        commandRunId = started.runId;
        if (priority) await db().ceoPriority.update({ where: { id: priority.id }, data: { commandRunId, lastDelegatedAt: new Date(), attempts: priority.commandRunId ? { increment: 1 } : undefined } });
        await db().ceoAction.create({ data: { ...scope, kind: "DELEGATED", reason: "founder_approved", priorityId: priority?.id ?? null, profile: p.profile, commandRunId, decisionId: d.id } });
      } else if (d.kind === "objective_off_track" && d.href?.startsWith("/objectives/")) {
        const objectiveId = d.href.slice("/objectives/".length);
        if (isUuid(objectiveId)) {
          const { taskId } = await planObjective(ctx, organizationId, companyId, objectiveId, {}, { replanReason: "the founder asked for a new plan because the objective is off track" });
          await db().ceoAction.create({ data: { ...scope, kind: "REPLANNED", reason: "founder_approved", taskId, decisionId: d.id, params: { objectiveId } } });
        }
      }
    } catch (err) {
      // The decision stays open when the follow-up work could not start, so the founder can try again.
      await db().ceoDecision.update({ where: { id: d.id }, data: { status: "OPEN", resolvedById: null, resolvedAt: null } });
      throw err;
    }
  }
  await transaction(async (tx) => {
    if (commandRunId) await tx.ceoDecision.update({ where: { id: d.id }, data: { commandRunId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "guide.ceo.decision_decided", resourceType: "ceo_decision", resourceId: d.id, oldValue: { status: "OPEN" }, newValue: { companyId, decision: input.decision, commandRunId } });
  });
  return { ok: true, commandRunId };
}

/** Drop a priority for the week (or bring it back). */
export async function setPriorityStatus(ctx: RequestContext, organizationId: string, companyId: string, priorityId: string, raw: z.input<typeof priorityStatusInput>) {
  const input = priorityStatusInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "agents.manage");
  if (!isUuid(priorityId)) throw notFound("Priority");
  return transaction(async (tx) => {
    const p = await tx.ceoPriority.findFirst({ where: { organizationId, companyId, id: priorityId }, select: { id: true, status: true } });
    if (!p) throw notFound("Priority");
    await tx.ceoPriority.update({ where: { id: p.id }, data: { status: input.status, resolvedAt: input.status === "DROPPED" ? new Date() : null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "guide.ceo.priority_status", resourceType: "ceo_priority", resourceId: p.id, oldValue: { status: p.status }, newValue: { companyId, status: input.status } });
    return { ok: true };
  });
}

/** Stop work the AI CEO delegated (the run, its step tasks and every task they delegated). */
export async function cancelCeoRun(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await authorize(ctx, organizationId, companyId, "agents.manage");
  if (!isUuid(runId)) throw notFound("Command run");
  const run = await db().commandRun.findFirst({ where: { organizationId, companyId, id: runId, origin: "CEO" }, select: { id: true } });
  if (!run) throw notFound("Command run");
  const cancelled = await cancelRun(ctx, { organizationId, companyId }, null, run.id);
  return { ok: true, cancelled };
}

/** Command Center strip: the AI CEO's top priorities this week and open decisions. Null when the viewer may not read AI work. */
export async function ceoSnapshot(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await companyChain(db(), organizationId, companyId);
  if (!(await can(ctx, "agents.read", chain))) return null;
  const scope = { organizationId, companyId };
  const [ceo, cycle, priorities, decisions] = await Promise.all([
    db().aiEmployee.findFirst({ where: { ...scope, profileKey: "ai_ceo", archivedAt: null }, orderBy: { createdAt: "asc" }, select: { name: true, status: true } }),
    db().ceoCycle.findFirst({ where: scope, orderBy: { day: "desc" }, select: { status: true, startedAt: true, completedAt: true, delegated: true, followedUp: true } }),
    db().ceoPriority.findMany({ where: { ...scope, weekKey: isoWeekKey(), status: "ACTIVE" }, orderBy: { score: "desc" }, take: 3, select: { id: true, kind: true, params: true, profile: true, commandRunId: true } }),
    db().ceoDecision.count({ where: { ...scope, status: "OPEN" } }),
  ]);
  const runIds = priorities.map((p) => p.commandRunId).filter((v): v is string => !!v);
  const runs = runIds.length ? await db().commandRun.findMany({ where: { ...scope, id: { in: runIds } }, select: { id: true, status: true } }) : [];
  const status = new Map(runs.map((r) => [r.id, r.status as string]));
  return {
    ceo,
    cycle: cycle ? { status: cycle.status as string, at: cycle.completedAt ?? cycle.startedAt, delegated: cycle.delegated + cycle.followedUp } : null,
    priorities: priorities.map((p) => ({ id: p.id, kind: p.kind, params: p.params as Record<string, string | number>, profile: p.profile, runStatus: p.commandRunId ? (status.get(p.commandRunId) ?? null) : null })),
    openDecisions: decisions,
  };
}
