import { z } from "zod";
import type { ProjectHealth, WorkTaskStatus } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, isAppError, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { createTask as createAgentTask } from "@/server/modules/agents/service";
import { createMilestone, setMilestoneDone } from "@/server/modules/objectives/service";
import { budgetSummary, createWorkProject, suggestHealth, updateWorkProject } from "./projects";
import { actorId, addDays, authorize, authorizeProject, day, dayString, eligibleUserIds, isUuid, today, toDay, uuid } from "./shared";
import { PRIORITIES } from "./tasks";

/**
 * Objective → executable work (COO, GAP-MATRIX §2.8 and flow step 16).
 *
 * `executeObjective` turns an active objective into a project with milestones and tasks whose finish-to-start
 * dependencies are real WorkTaskDependency rows (tasks are scheduled after their predecessors), and links the project
 * to the objective through an objective milestone (objectives/service createMilestone). `executionStatus` tracks it
 * from the stored tasks only: progress per milestone, tasks ready to start, blocked tasks and the root blockers holding
 * them up (overdue, unassigned or stalled), the remaining critical path and a health computed from all of it.
 * `runExecutionTracking` (worker, hourly) closes milestones whose tasks are all done, completes objective-linked
 * projects (and their objective milestones) when every task is done, and tells the owner once a day about critical
 * blockers.
 */

const OPEN_STATUSES: WorkTaskStatus[] = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW"];
const isOpen = (s: WorkTaskStatus) => OPEN_STATUSES.includes(s);
const STALLED_DAYS = 7;
const MAX_TASKS = 5000;

const execTask = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  /** Days after the project start; moved later automatically when a predecessor ends after it. */
  offsetDays: z.number().int().min(0).max(3650).default(0),
  durationDays: z.number().int().min(1).max(3650).default(1),
  points: z.number().int().min(0).max(100).optional(),
  /** Exact title of one of the plan's milestones. */
  milestone: z.string().trim().max(200).optional(),
  /** Indexes (in `tasks`) of the tasks that must be done before this one starts. */
  dependsOn: z.array(z.number().int().min(0).max(199)).max(20).default([]),
  assigneeId: uuid.optional(),
});

export const executeObjectiveInput = z.object({
  objectiveId: uuid,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(5000).optional(),
  startDate: day.optional(),
  dueDate: day.optional(),
  ownerId: uuid.optional(),
  milestones: z.array(z.object({ title: z.string().trim().min(1).max(200), offsetDays: z.number().int().min(0).max(3650) })).max(30).default([]),
  tasks: z.array(execTask).min(1).max(120),
});
export type ExecuteObjectiveInput = z.input<typeof executeObjectiveInput>;

/**
 * Validates the dependency graph (indexes in range, no self or circular dependencies, known milestones) and returns
 * each task's effective offset: never before the end of its predecessors.
 */
export function scheduleExecutionPlan(input: Pick<z.output<typeof executeObjectiveInput>, "tasks" | "milestones">) {
  const n = input.tasks.length;
  const titles = new Set<string>();
  for (const m of input.milestones) {
    if (titles.has(m.title)) throw invalid(`Milestone "${m.title}" appears twice`, { reason: "work_execution_milestone_duplicate" });
    titles.add(m.title);
  }
  const indegree = new Array<number>(n).fill(0);
  const next: number[][] = Array.from({ length: n }, () => []);
  input.tasks.forEach((t, i) => {
    if (t.milestone && !titles.has(t.milestone)) throw invalid(`Task ${i} names an unknown milestone "${t.milestone}"`, { reason: "work_execution_milestone_unknown" });
    for (const d of new Set(t.dependsOn)) {
      if (d >= n) throw invalid(`Task ${i} depends on task ${d}, which does not exist`, { reason: "work_execution_dependency_unknown" });
      if (d === i) throw invalid(`Task ${i} cannot depend on itself`, { reason: "work_execution_dependency_self" });
      indegree[i]!++;
      next[d]!.push(i);
    }
  });
  const offsets = input.tasks.map((t) => t.offsetDays);
  const queue = indegree.flatMap((d, i) => (d === 0 ? [i] : []));
  let visited = 0;
  while (queue.length) {
    const i = queue.shift()!;
    visited++;
    const end = offsets[i]! + input.tasks[i]!.durationDays;
    for (const j of next[i]!) {
      offsets[j] = Math.max(offsets[j]!, end);
      if (--indegree[j]! === 0) queue.push(j);
    }
  }
  if (visited !== n) throw invalid("The task dependencies form a cycle", { reason: "work_execution_dependency_cycle" });
  return { offsets, shifted: offsets.filter((o, i) => o !== input.tasks[i]!.offsetDays).length };
}

/** Create the project, milestones, tasks and dependencies for an objective, and link it to the objective. */
export async function executeObjective(ctx: RequestContext, organizationId: string, companyId: string, raw: ExecuteObjectiveInput) {
  const input = executeObjectiveInput.parse(raw);
  const plan = scheduleExecutionPlan(input);
  const chain = await authorize(ctx, organizationId, companyId, "projects.manage");
  await requirePermission(ctx, "objectives.manage", chain);
  const objective = await db().objective.findFirst({ where: { id: input.objectiveId, organizationId, companyId }, select: { id: true, title: true, status: true, targetDate: true } });
  if (!objective) throw notFound("Objective");
  if (objective.status !== "ACTIVE") throw conflict("Only active objectives can be executed", { reason: "work_execution_objective_inactive" });
  const assignees = [...new Set(input.tasks.flatMap((t) => (t.assigneeId ? [t.assigneeId] : [])))];
  if (assignees.length && (await eligibleUserIds(db(), organizationId, chain, "projects.read", assignees)).length !== assignees.length) {
    throw invalid("An assignee has no access to projects", { reason: "work_user_ineligible" });
  }
  const start = toDay(input.startDate) ?? today();
  const lastDay = Math.max(0, ...input.tasks.map((t, i) => plan.offsets[i]! + t.durationDays - 1), ...input.milestones.map((m) => m.offsetDays));
  const due = toDay(input.dueDate) ?? objective.targetDate ?? addDays(start, lastDay);
  const project = await createWorkProject(ctx, organizationId, companyId, {
    name: input.name,
    description: input.description ?? `Executes the objective "${objective.title}".`,
    status: "ACTIVE",
    ownerId: input.ownerId,
    startDate: dayString(start),
    dueDate: dayString(due),
    memberIds: assignees,
  });
  const created = await transaction(async (tx) => {
    await authorizeProject(ctx, organizationId, companyId, project.id, "projects.manage", tx);
    const milestoneIds = new Map<string, string>();
    for (const m of input.milestones) {
      const row = await tx.projectMilestone.create({ data: { organizationId, companyId, projectId: project.id, title: m.title, dueDate: addDays(start, m.offsetDays) } });
      milestoneIds.set(m.title, row.id);
    }
    const ids: string[] = [];
    for (const [i, t] of input.tasks.entries()) {
      const offset = plan.offsets[i]!;
      const row = await tx.workTask.create({
        data: {
          organizationId,
          companyId,
          projectId: project.id,
          title: t.title,
          description: t.description ?? null,
          priority: t.priority,
          status: "TODO",
          assigneeId: t.assigneeId ?? null,
          startDate: addDays(start, offset),
          dueDate: addDays(start, offset + t.durationDays - 1),
          estimatePoints: t.points ?? null,
          milestoneId: t.milestone ? (milestoneIds.get(t.milestone) ?? null) : null,
          position: i + 1,
          sourceType: "objective",
          sourceId: objective.id,
          createdById: actorId(ctx, organizationId),
        },
        select: { id: true },
      });
      ids.push(row.id);
    }
    const deps = input.tasks.flatMap((t, i) => [...new Set(t.dependsOn)].map((d) => ({ organizationId, companyId, taskId: ids[i]!, dependsOnId: ids[d]! })));
    if (deps.length) await tx.workTaskDependency.createMany({ data: deps, skipDuplicates: true });
    for (const userId of assignees.filter((u) => u !== ctx.actor.id)) {
      const count = input.tasks.filter((t) => t.assigneeId === userId).length;
      await notifyUsers(tx, organizationId, [userId], "work.taskAssigned", { companyId, title: `${input.name} (${count})`, href: `/projects/${project.id}/execution` });
    }
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "work.objective_execution.created",
      resourceType: "project",
      resourceId: project.id,
      newValue: { objectiveId: objective.id, milestones: milestoneIds.size, tasks: ids.length, dependencies: deps.length, rescheduled: plan.shifted },
    });
    return { milestones: milestoneIds.size, tasks: ids.length, dependencies: deps.length };
  });
  const link = await createMilestone(ctx, organizationId, companyId, { objectiveId: objective.id, title: `Project: ${input.name}`.slice(0, 200), dueDate: dayString(due) ?? undefined, projectId: project.id });
  return { projectId: project.id, objectiveId: objective.id, objectiveMilestoneId: link.id, ...created, rescheduled: plan.shifted, startDate: dayString(start), dueDate: dayString(due) };
}

export const EXECUTION_PLAN_SUBJECT = "objective_execution";
export const planExecutionInput = z.object({ objectiveId: uuid, guidance: z.string().trim().max(1500).optional() });

/**
 * Ask the AI project manager to propose the execution of an objective: it reads the objective and the team's workload
 * and files one plan_objective_execution proposal, which a person approves before anything is created.
 */
export async function requestObjectiveExecutionPlan(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof planExecutionInput>) {
  const input = planExecutionInput.parse(raw);
  const chain = await authorize(ctx, organizationId, companyId, "projects.manage");
  await requirePermission(ctx, "objectives.manage", chain);
  const objective = await db().objective.findFirst({ where: { id: input.objectiveId, organizationId, companyId }, select: { id: true, title: true, description: true, status: true, targetDate: true } });
  if (!objective) throw notFound("Objective");
  if (objective.status !== "ACTIVE") throw conflict("Only active objectives can be executed", { reason: "work_execution_objective_inactive" });
  const instructions = [
    `Turn this objective into executable work. Objective id: ${objective.id}. Title: ${objective.title}.${objective.description ? ` Description: ${objective.description.slice(0, 1500)}` : ""}${objective.targetDate ? ` Target date: ${dayString(objective.targetDate)}.` : ""}`,
    "Read it with read_objectives (key results and existing milestones), read_projects to avoid duplicating work already planned, and read_team_workload for who can take tasks.",
    "Then call plan_objective_execution exactly once: one project, 3–6 milestones, 8–40 concrete tasks with plain titles, durations, priorities, the milestone each belongs to, dependsOn (indexes of tasks that must finish first) and an assignee only when the workload shows a suitable person. The proposal waits for a person's approval; say so in your answer and summarise the plan.",
    input.guidance ? `Guidance from the requester: ${input.guidance}` : "",
    `Today: ${dayString(today())}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return createAgentTask(ctx, organizationId, companyId, { profile: "ai_project_manager", title: `Execution plan: ${objective.title.slice(0, 150)}`, instructions, subject: { type: EXECUTION_PLAN_SUBJECT, id: objective.id } });
}

/** Active objectives with how many projects carry them (for the "execute an objective" list). */
export async function executableObjectives(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const rows = await db().objective.findMany({
    where: { organizationId, companyId, status: "ACTIVE" },
    orderBy: [{ targetDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 20,
    select: { id: true, title: true, targetDate: true, milestones: { where: { projectId: { not: null } }, select: { projectId: true, completedAt: true } } },
  });
  return rows.map((o) => ({ id: o.id, title: o.title, targetDate: o.targetDate, projects: [...new Set(o.milestones.map((m) => m.projectId!))], openProjects: o.milestones.filter((m) => !m.completedAt).length }));
}

// ───────────── Tracking ─────────────

export type BlockerReason = "overdue" | "unassigned" | "stalled" | "not_started";

/** Execution status of one project from its stored tasks, dependencies, milestones, risks and budget (no auth). */
async function computeStatus(organizationId: string, companyId: string, projectId: string, now = new Date()) {
  const p = await db().project.findFirst({ where: { id: projectId, organizationId, companyId }, select: { id: true, name: true, status: true, health: true, ownerId: true, startDate: true, dueDate: true, budgetMinor: true } });
  if (!p) throw notFound("Project");
  const day0 = today(now);
  const [tasks, milestones, highRisks, budget, links] = await Promise.all([
    db().workTask.findMany({
      where: { organizationId, companyId, projectId, archivedAt: null },
      select: { id: true, title: true, status: true, priority: true, assigneeId: true, startDate: true, dueDate: true, milestoneId: true, updatedAt: true, completedAt: true },
      orderBy: { position: "asc" },
      take: MAX_TASKS,
    }),
    db().projectMilestone.findMany({ where: { organizationId, companyId, projectId }, orderBy: { dueDate: { sort: "asc", nulls: "last" } }, select: { id: true, title: true, dueDate: true, completedAt: true } }),
    db().projectRisk.findMany({ where: { organizationId, companyId, projectId, status: { in: ["OPEN", "MITIGATING"] } }, select: { probability: true, impact: true }, take: 500 }),
    budgetSummary(projectId, p.budgetMinor),
    db().milestone.findMany({ where: { organizationId, companyId, projectId }, select: { id: true, title: true, completedAt: true, objective: { select: { id: true, title: true, status: true } } } }),
  ]);
  const ids = tasks.map((t) => t.id);
  const deps = ids.length ? await db().workTaskDependency.findMany({ where: { companyId, taskId: { in: ids } }, select: { taskId: true, dependsOnId: true }, take: 20_000 }) : [];
  // Predecessors may live in another project: load their state too.
  const outside = [...new Set(deps.map((d) => d.dependsOnId))].filter((id) => !ids.includes(id));
  const external = outside.length ? await db().workTask.findMany({ where: { companyId, id: { in: outside } }, select: { id: true, title: true, status: true, archivedAt: true, projectId: true } }) : [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const openPred = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const d of deps) {
    const pred = byId.get(d.dependsOnId) ?? external.find((x) => x.id === d.dependsOnId);
    if (!pred || (pred as { archivedAt?: Date | null }).archivedAt || !isOpen(pred.status)) continue;
    const t = byId.get(d.taskId);
    if (!t || !isOpen(t.status)) continue;
    (openPred.get(d.taskId) ?? openPred.set(d.taskId, []).get(d.taskId)!).push(d.dependsOnId);
    (dependents.get(d.dependsOnId) ?? dependents.set(d.dependsOnId, []).get(d.dependsOnId)!).push(d.taskId);
  }
  const live = tasks.filter((t) => t.status !== "CANCELLED");
  const open = live.filter((t) => isOpen(t.status));
  const done = live.length - open.length;
  const stalledBefore = addDays(day0, -STALLED_DAYS);
  const overdue = open.filter((t) => t.dueDate && t.dueDate < day0);
  const blocked = open.filter((t) => openPred.has(t.id));
  const ready = open.filter((t) => !openPred.has(t.id) && (t.status === "BACKLOG" || t.status === "TODO"));
  const stalled = open.filter((t) => (t.status === "IN_PROGRESS" || t.status === "IN_REVIEW") && t.updatedAt < stalledBefore);

  // Transitive count of open tasks waiting on each open predecessor.
  const downstream = (id: string) => {
    const seen = new Set<string>();
    const stack = [...(dependents.get(id) ?? [])];
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...(dependents.get(x) ?? []));
    }
    return seen.size;
  };
  const blockerRows = [...dependents.keys()]
    .map((id) => {
      const t = byId.get(id);
      const ext = t ? null : external.find((x) => x.id === id);
      const reasons: BlockerReason[] = [];
      if (t) {
        if (t.dueDate && t.dueDate < day0) reasons.push("overdue");
        if (!t.assigneeId) reasons.push("unassigned");
        if ((t.status === "IN_PROGRESS" || t.status === "IN_REVIEW") && t.updatedAt < stalledBefore) reasons.push("stalled");
        if ((t.status === "BACKLOG" || t.status === "TODO") && t.startDate && t.startDate < day0) reasons.push("not_started");
      }
      return {
        id,
        title: t?.title ?? ext?.title ?? "",
        status: t?.status ?? ext?.status ?? "TODO",
        assigneeId: t?.assigneeId ?? null,
        dueDate: t?.dueDate ?? null,
        externalProjectId: ext?.projectId ?? null,
        root: !openPred.has(id),
        waiting: downstream(id),
        reasons,
      };
    })
    .sort((a, b) => b.waiting - a.waiting);
  const critical = blockerRows.filter((b) => b.root && b.reasons.length > 0);

  // Remaining critical path: longest chain of open tasks (in working days of each task's planned span).
  const span = (t: (typeof tasks)[number]) => (t.startDate && t.dueDate ? Math.max(1, Math.round((t.dueDate.getTime() - t.startDate.getTime()) / 86_400_000) + 1) : 1);
  const memo = new Map<string, number>();
  const chain = (id: string, guard: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (guard.has(id)) return 0;
    guard.add(id);
    const t = byId.get(id);
    const own = t ? span(t) : 1;
    const after = Math.max(0, ...(dependents.get(id) ?? []).map((x) => chain(x, guard)));
    guard.delete(id);
    memo.set(id, own + after);
    return own + after;
  };
  const criticalDays = open.length ? Math.max(...open.filter((t) => !openPred.has(t.id)).map((t) => chain(t.id, new Set())), 0) : 0;
  const projectedFinish = open.length ? addDays(day0, Math.max(0, criticalDays - 1)) : null;
  const projectedLate = !!(projectedFinish && p.dueDate && projectedFinish > p.dueDate);

  const milestoneRows = milestones.map((m) => {
    const mine = live.filter((t) => t.milestoneId === m.id);
    const mDone = mine.filter((t) => !isOpen(t.status)).length;
    return { ...m, total: mine.length, done: mDone, late: !m.completedAt && !!m.dueDate && m.dueDate < day0 && mDone < mine.length, ready: mine.length > 0 && mDone === mine.length };
  });
  const base = suggestHealth({ dueDate: p.dueDate, status: p.status, openTasks: open.length, overdueTasks: overdue.length, highRisks: highRisks.filter((r) => r.probability * r.impact >= 15).length, usedPercent: budget.usedPercent });
  let health: ProjectHealth = base;
  if (p.status !== "COMPLETED" && p.status !== "CANCELLED") {
    if (health === "ON_TRACK" && (critical.length > 0 || stalled.length > 0 || milestoneRows.some((m) => m.late) || projectedLate)) health = "AT_RISK";
    if (health === "AT_RISK" && critical.some((b) => b.reasons.includes("overdue") && b.waiting >= 3)) health = "OFF_TRACK";
  }
  const pick = (t: (typeof tasks)[number]) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, assigneeId: t.assigneeId, startDate: t.startDate, dueDate: t.dueDate, waitingOn: openPred.get(t.id)?.length ?? 0 });
  return {
    project: p,
    objectives: links.map((l) => ({ milestoneId: l.id, milestoneTitle: l.title, completedAt: l.completedAt, objectiveId: l.objective.id, objectiveTitle: l.objective.title, objectiveStatus: l.objective.status })),
    totals: { total: live.length, done, open: open.length, progress: live.length ? Math.round((done / live.length) * 100) : 0, blocked: blocked.length, ready: ready.length, overdue: overdue.length, stalled: stalled.length, dependencies: deps.length },
    complete: live.length > 0 && open.length === 0,
    health,
    manualHealth: p.health,
    projectedFinish,
    projectedLate,
    criticalDays,
    milestones: milestoneRows,
    ready: ready.slice(0, 50).map(pick),
    blocked: blocked.slice(0, 50).map(pick),
    stalled: stalled.slice(0, 50).map(pick),
    overdue: overdue.slice(0, 50).map(pick),
    blockers: blockerRows.slice(0, 50),
    criticalBlockers: critical.slice(0, 20),
    truncated: tasks.length >= MAX_TASKS,
  };
}

export type ExecutionStatus = Awaited<ReturnType<typeof computeStatus>>;

export async function executionStatus(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, now = new Date()) {
  await authorizeProject(ctx, organizationId, companyId, projectId, "projects.read");
  return computeStatus(organizationId, companyId, projectId, now);
}

/** All projects carrying an objective (through its milestones), with their execution status and the roll-up. */
export async function objectiveExecutionStatus(ctx: RequestContext, organizationId: string, companyId: string, objectiveId: string, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  if (!isUuid(objectiveId)) throw notFound("Objective");
  const objective = await db().objective.findFirst({ where: { id: objectiveId, organizationId, companyId }, select: { id: true, title: true, status: true, targetDate: true, milestones: { select: { id: true, title: true, completedAt: true, projectId: true, dueDate: true } } } });
  if (!objective) throw notFound("Objective");
  const projectIds = [...new Set(objective.milestones.flatMap((m) => (m.projectId ? [m.projectId] : [])))];
  const projects: ExecutionStatus[] = [];
  let hidden = 0;
  for (const id of projectIds) {
    try {
      projects.push(await executionStatus(ctx, organizationId, companyId, id, now));
    } catch (err) {
      if (isAppError(err) && (err.code === "forbidden" || err.code === "not_found")) hidden++;
      else throw err;
    }
  }
  const total = projects.reduce((s, p) => s + p.totals.total, 0);
  const done = projects.reduce((s, p) => s + p.totals.done, 0);
  const order: ProjectHealth[] = ["ON_TRACK", "AT_RISK", "OFF_TRACK"];
  return {
    objective: { id: objective.id, title: objective.title, status: objective.status, targetDate: objective.targetDate },
    milestones: objective.milestones,
    projects,
    hiddenProjects: hidden,
    totals: { projects: projects.length, total, done, progress: total ? Math.round((done / total) * 100) : 0, blocked: projects.reduce((s, p) => s + p.totals.blocked, 0), criticalBlockers: projects.reduce((s, p) => s + p.criticalBlockers.length, 0) },
    health: projects.length ? projects.map((p) => p.health).reduce((w, h) => (order.indexOf(h) > order.indexOf(w) ? h : w), "ON_TRACK" as ProjectHealth) : null,
    complete: projects.length > 0 && projects.every((p) => p.complete),
  };
}

/**
 * Worker job (hourly): tracks live projects until done. Closes project milestones whose tasks are all done; when every
 * task of an objective-linked project is done, completes the project and its objective milestones; notifies the owner
 * of critical blockers at most once a day per project.
 */
export async function runExecutionTracking(now = new Date()) {
  const ctx = systemContext();
  const start = today(now);
  const projects = await db().project.findMany({
    where: { status: { in: ["PLANNED", "ACTIVE"] }, archivedAt: null, workTasks: { some: { archivedAt: null } } },
    select: { id: true, organizationId: true, companyId: true, ownerId: true, name: true, status: true },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  const out = { milestonesClosed: 0, projectsCompleted: 0, objectiveMilestonesClosed: 0, blockerAlerts: 0 };
  for (const p of projects) {
    try {
      const s = await computeStatus(p.organizationId, p.companyId, p.id, now);
      for (const m of s.milestones.filter((x) => !x.completedAt && x.ready)) {
        await transaction(async (tx) => {
          const r = await tx.projectMilestone.updateMany({ where: { id: m.id, companyId: p.companyId, completedAt: null }, data: { completedAt: now } });
          if (r.count) await writeAudit(tx, ctx, { category: "TENANT", organizationId: p.organizationId, action: "project_milestone.completed", resourceType: "project_milestone", resourceId: m.id, newValue: { automatic: true, tasks: m.total } });
        });
        out.milestonesClosed++;
      }
      if (s.complete && s.objectives.length) {
        for (const o of s.objectives.filter((x) => !x.completedAt)) {
          await setMilestoneDone(ctx, p.organizationId, p.companyId, o.milestoneId, { done: true });
          out.objectiveMilestonesClosed++;
        }
        if (p.status === "ACTIVE") {
          await updateWorkProject(ctx, p.organizationId, p.companyId, p.id, { status: "COMPLETED" });
          out.projectsCompleted++;
        }
        continue;
      }
      if (s.criticalBlockers.length && p.ownerId) {
        const href = `/projects/${p.id}/execution`;
        const already = await db().notification.findFirst({ where: { organizationId: p.organizationId, userId: p.ownerId, type: "work.deadlineRisk", createdAt: { gte: start }, payload: { path: ["href"], equals: href } }, select: { id: true } });
        if (!already) {
          await transaction((tx) => notifyUsers(tx, p.organizationId, [p.ownerId], "work.deadlineRisk", { companyId: p.companyId, title: `${p.name} — ${s.criticalBlockers.length} blocker(s) holding up ${s.totals.blocked} task(s)`, href }));
          out.blockerAlerts++;
        }
      }
    } catch (err) {
      logger.warn({ err, projectId: p.id }, "execution tracking failed");
    }
  }
  return out.milestonesClosed + out.projectsCompleted + out.objectiveMilestonesClosed + out.blockerAlerts;
}

