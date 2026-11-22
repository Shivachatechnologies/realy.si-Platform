import { z } from "zod";
import type { WorkTaskStatus } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask as createAgentTask } from "@/server/modules/agents/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { actorId, addDays, authorizeProject, blank, day, dayString, isUuid, optText, projectScope, toDay, today, userNames, uuid } from "./shared";
import { createWorkTask, taskListSelect } from "./tasks";

const OPEN = { notIn: ["DONE", "CANCELLED"] as WorkTaskStatus[] };

export const sprintInput = z.object({
  name: z.string().trim().min(1).max(120),
  goal: z.string().trim().max(2000).optional(),
  startDate: day,
  endDate: day,
  capacityPoints: z.number().int().min(0).max(10_000).nullable().optional(),
});
export const updateSprintInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  goal: optText(2000),
  startDate: day.optional(),
  endDate: day.optional(),
  capacityPoints: z.number().int().min(0).max(10_000).nullable().optional(),
});
export const sprintTasksInput = z.object({ add: z.array(uuid).max(200).default([]), remove: z.array(uuid).max(200).default([]) });
export const completeSprintInput = z.object({ rollover: z.literal("backlog").or(uuid).default("backlog") });
export const retroItemInput = z.object({ kind: z.enum(["WENT_WELL", "TO_IMPROVE", "ACTION"]), text: z.string().trim().min(1).max(1000) });

const audit = (tx: Tx, ctx: RequestContext, organizationId: string, action: string, resourceId: string, newValue?: unknown, oldValue?: unknown) =>
  writeAudit(tx, ctx, { category: "TENANT", organizationId, action, resourceType: "sprint", resourceId, newValue, oldValue });

async function sprintOf(tx: Tx | ReturnType<typeof db>, organizationId: string, companyId: string, sprintId: string) {
  if (!isUuid(sprintId)) throw notFound("Sprint");
  const s = await tx.sprint.findFirst({ where: { id: sprintId, organizationId, companyId } });
  if (!s) throw notFound("Sprint");
  return s;
}

const points = (tasks: { estimatePoints: number | null }[]) => tasks.reduce((n, t) => n + (t.estimatePoints ?? 0), 0);

export async function createSprint(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof sprintInput>) {
  const input = sprintInput.parse(raw);
  if (input.endDate < input.startDate) throw invalid("The end date is before the start date", { reason: "work_dates_order" });
  return transaction(async (tx) => {
    await authorizeProject(ctx, organizationId, companyId, projectId, "projects.manage", tx);
    const s = await tx.sprint.create({
      data: { organizationId, companyId, projectId, name: input.name, goal: input.goal || null, startDate: toDay(input.startDate)!, endDate: toDay(input.endDate)!, capacityPoints: input.capacityPoints ?? null },
    });
    await audit(tx, ctx, organizationId, "sprint.created", s.id, { name: s.name, projectId });
    return s;
  });
}

export async function updateSprint(ctx: RequestContext, organizationId: string, companyId: string, sprintId: string, raw: z.input<typeof updateSprintInput>) {
  const input = updateSprintInput.parse(raw);
  return transaction(async (tx) => {
    const before = await sprintOf(tx, organizationId, companyId, sprintId);
    await authorizeProject(ctx, organizationId, companyId, before.projectId, "projects.manage", tx);
    if (before.status === "COMPLETED") throw conflict("The sprint is completed", { reason: "work_sprint_completed" });
    const start = input.startDate ? toDay(input.startDate)! : before.startDate;
    const end = input.endDate ? toDay(input.endDate)! : before.endDate;
    if (end < start) throw invalid("The end date is before the start date", { reason: "work_dates_order" });
    const s = await tx.sprint.update({
      where: { id: sprintId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.goal !== undefined ? { goal: blank(input.goal) ?? null } : {}),
        startDate: start,
        endDate: end,
        ...(input.capacityPoints !== undefined ? { capacityPoints: input.capacityPoints } : {}),
      },
    });
    await audit(tx, ctx, organizationId, "sprint.updated", sprintId, input);
    return s;
  });
}

export async function deleteSprint(ctx: RequestContext, organizationId: string, companyId: string, sprintId: string) {
  return transaction(async (tx) => {
    const s = await sprintOf(tx, organizationId, companyId, sprintId);
    await authorizeProject(ctx, organizationId, companyId, s.projectId, "projects.manage", tx);
    if (s.status !== "PLANNED") throw conflict("Only planned sprints can be deleted", { reason: "work_sprint_not_planned" });
    await tx.workTask.updateMany({ where: { sprintId, companyId }, data: { sprintId: null } });
    await tx.sprint.delete({ where: { id: sprintId } });
    await audit(tx, ctx, organizationId, "sprint.deleted", sprintId, undefined, { name: s.name });
    return { ok: true, projectId: s.projectId };
  });
}

/** Sprint planning: move backlog tasks into the sprint, or back out. */
export async function setSprintTasks(ctx: RequestContext, organizationId: string, companyId: string, sprintId: string, raw: z.input<typeof sprintTasksInput>) {
  const input = sprintTasksInput.parse(raw);
  return transaction(async (tx) => {
    const s = await sprintOf(tx, organizationId, companyId, sprintId);
    await authorizeProject(ctx, organizationId, companyId, s.projectId, "projects.manage", tx);
    if (s.status === "COMPLETED") throw conflict("The sprint is completed", { reason: "work_sprint_completed" });
    const added = input.add.length
      ? await tx.workTask.updateMany({ where: { id: { in: input.add }, organizationId, companyId, projectId: s.projectId, archivedAt: null }, data: { sprintId } })
      : { count: 0 };
    const removed = input.remove.length ? await tx.workTask.updateMany({ where: { id: { in: input.remove }, companyId, sprintId }, data: { sprintId: null } }) : { count: 0 };
    await audit(tx, ctx, organizationId, "sprint.planned", sprintId, { added: added.count, removed: removed.count });
    return { added: added.count, removed: removed.count };
  });
}

export async function startSprint(ctx: RequestContext, organizationId: string, companyId: string, sprintId: string) {
  return transaction(async (tx) => {
    const s = await sprintOf(tx, organizationId, companyId, sprintId);
    await authorizeProject(ctx, organizationId, companyId, s.projectId, "projects.manage", tx);
    if (s.status !== "PLANNED") throw conflict("Only planned sprints can start", { reason: "work_sprint_not_planned" });
    if (await tx.sprint.findFirst({ where: { projectId: s.projectId, status: "ACTIVE" }, select: { id: true } })) throw conflict("Another sprint is active", { reason: "work_sprint_active_exists" });
    const committed = await tx.workTask.aggregate({ where: { sprintId, archivedAt: null, status: { not: "CANCELLED" } }, _sum: { estimatePoints: true } });
    const updated = await tx.sprint.update({ where: { id: sprintId }, data: { status: "ACTIVE", startedAt: new Date(), committedPoints: committed._sum.estimatePoints ?? 0 } });
    await audit(tx, ctx, organizationId, "sprint.started", sprintId, { committedPoints: updated.committedPoints });
    return updated;
  });
}

/** Close the sprint: completed points are recorded (velocity) and unfinished tasks roll over to the next sprint or backlog. */
export async function completeSprint(ctx: RequestContext, organizationId: string, companyId: string, sprintId: string, raw: z.input<typeof completeSprintInput>) {
  const { rollover } = completeSprintInput.parse(raw);
  return transaction(async (tx) => {
    const s = await sprintOf(tx, organizationId, companyId, sprintId);
    await authorizeProject(ctx, organizationId, companyId, s.projectId, "projects.manage", tx);
    if (s.status !== "ACTIVE") throw conflict("Only an active sprint can be completed", { reason: "work_sprint_not_active" });
    let target: string | null = null;
    if (rollover !== "backlog") {
      const next = await tx.sprint.findFirst({ where: { id: rollover, projectId: s.projectId, status: "PLANNED" }, select: { id: true } });
      if (!next) throw notFound("Sprint");
      target = next.id;
    }
    const done = await tx.workTask.aggregate({ where: { sprintId, status: "DONE", archivedAt: null }, _sum: { estimatePoints: true } });
    const rolled = await tx.workTask.updateMany({ where: { sprintId, status: OPEN }, data: { sprintId: target } });
    const updated = await tx.sprint.update({ where: { id: sprintId }, data: { status: "COMPLETED", completedAt: new Date(), completedPoints: done._sum.estimatePoints ?? 0 } });
    await audit(tx, ctx, organizationId, "sprint.completed", sprintId, { completedPoints: updated.completedPoints, rolledOver: rolled.count, to: target ?? "backlog" });
    return { ...updated, rolledOver: rolled.count };
  });
}

/**
 * Burndown: remaining points per day from the start to the end date. Remaining = committed (or current scope)
 * minus points of tasks completed by that day. The ideal line falls linearly to zero.
 */
export function burndownSeries(sprint: { startDate: Date; endDate: Date; committedPoints: number | null; status: string; completedAt: Date | null }, tasks: { estimatePoints: number | null; status: string; completedAt: Date | null }[]) {
  const scope = sprint.committedPoints ?? points(tasks.filter((t) => t.status !== "CANCELLED"));
  const days = Math.max(1, Math.round((sprint.endDate.getTime() - sprint.startDate.getTime()) / 86_400_000));
  const lastActual = sprint.completedAt ?? new Date();
  const out: { date: string; ideal: number; remaining: number | null }[] = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(sprint.startDate, i);
    const endOfDay = addDays(d, 1);
    const burned = points(tasks.filter((t) => t.status === "DONE" && t.completedAt && t.completedAt < endOfDay));
    const future = sprint.status === "PLANNED" || d > lastActual;
    out.push({ date: dayString(d)!, ideal: Math.round((scope * (1 - i / days)) * 10) / 10, remaining: future ? null : Math.max(0, scope - burned) });
  }
  return { scope, series: out };
}

export async function getSprint(ctx: RequestContext, organizationId: string, companyId: string, sprintId: string) {
  const s = await sprintOf(db(), organizationId, companyId, sprintId);
  await authorizeProject(ctx, organizationId, companyId, s.projectId, "projects.read");
  const [project, tasks, retro, otherSprints] = await Promise.all([
    db().project.findFirstOrThrow({ where: { id: s.projectId }, select: { id: true, name: true } }),
    db().workTask.findMany({ where: { sprintId, archivedAt: null }, orderBy: [{ status: "asc" }, { position: "asc" }], select: taskListSelect }),
    db().sprintRetroItem.findMany({ take: 500, where: { sprintId }, orderBy: { createdAt: "asc" } }),
    db().sprint.findMany({ where: { projectId: s.projectId, status: "PLANNED", id: { not: sprintId } }, orderBy: { startDate: "asc" }, select: { id: true, name: true } }),
  ]);
  const names = await userNames(db(), retro.map((r) => r.authorId));
  const done = tasks.filter((t) => t.status === "DONE");
  return {
    ...s,
    project,
    tasks,
    totals: { tasks: tasks.length, done: done.length, points: points(tasks.filter((t) => t.status !== "CANCELLED")), donePoints: points(done) },
    burndown: burndownSeries(s, tasks),
    retro: retro.map((r) => ({ ...r, authorName: names.get(r.authorId) ?? null })),
    plannedSprints: otherSprints,
  };
}

/** Project agile overview: sprints, backlog (open tasks without a sprint) and velocity of completed sprints. */
export async function projectAgile(ctx: RequestContext, organizationId: string, companyId: string, projectId: string) {
  await authorizeProject(ctx, organizationId, companyId, projectId, "projects.read");
  const [sprints, backlog, sprintTasks] = await Promise.all([
    db().sprint.findMany({ where: { projectId }, orderBy: [{ startDate: "desc" }], take: 50 }),
    db().workTask.findMany({ where: { projectId, archivedAt: null, sprintId: null, parentId: null, status: OPEN }, orderBy: [{ priority: "desc" }, { position: "asc" }], take: 500, select: taskListSelect }),
    db().workTask.groupBy({ by: ["sprintId", "status"], where: { projectId, archivedAt: null, sprintId: { not: null } }, _count: { _all: true }, _sum: { estimatePoints: true } }),
  ]);
  const velocity = sprints
    .filter((s) => s.status === "COMPLETED")
    .slice(0, 10)
    .reverse()
    .map((s) => ({ id: s.id, name: s.name, committed: s.committedPoints ?? 0, completed: s.completedPoints ?? 0 }));
  const avgVelocity = velocity.length ? Math.round(velocity.reduce((n, v) => n + v.completed, 0) / velocity.length) : null;
  return {
    sprints: sprints.map((s) => {
      const rows = sprintTasks.filter((r) => r.sprintId === s.id);
      return {
        ...s,
        taskCount: rows.reduce((n, r) => n + r._count._all, 0),
        points: rows.filter((r) => r.status !== "CANCELLED").reduce((n, r) => n + (r._sum.estimatePoints ?? 0), 0),
        donePoints: rows.filter((r) => r.status === "DONE").reduce((n, r) => n + (r._sum.estimatePoints ?? 0), 0),
      };
    }),
    backlog,
    backlogPoints: points(backlog),
    velocity,
    avgVelocity,
  };
}

export async function addRetroItem(ctx: RequestContext, organizationId: string, companyId: string, sprintId: string, raw: z.input<typeof retroItemInput>) {
  const input = retroItemInput.parse(raw);
  return transaction(async (tx) => {
    const s = await sprintOf(tx, organizationId, companyId, sprintId);
    await authorizeProject(ctx, organizationId, companyId, s.projectId, "projects.read", tx);
    const item = await tx.sprintRetroItem.create({ data: { organizationId, companyId, sprintId, kind: input.kind, text: input.text, authorId: actorId(ctx, organizationId) } });
    await audit(tx, ctx, organizationId, "sprint.retro_item_added", sprintId, { kind: input.kind });
    return item;
  });
}

export async function deleteRetroItem(ctx: RequestContext, organizationId: string, companyId: string, itemId: string) {
  return transaction(async (tx) => {
    if (!isUuid(itemId)) throw notFound("Item");
    const item = await tx.sprintRetroItem.findFirst({ where: { id: itemId, organizationId, companyId }, include: { sprint: { select: { projectId: true } } } });
    if (!item) throw notFound("Item");
    await authorizeProject(ctx, organizationId, companyId, item.sprint.projectId, item.authorId === ctx.actor.id ? "projects.read" : "projects.manage", tx);
    await tx.sprintRetroItem.delete({ where: { id: itemId } });
    await audit(tx, ctx, organizationId, "sprint.retro_item_deleted", item.sprintId, { itemId });
    return { ok: true };
  });
}

/** Turn a retrospective action item into a backlog task (once). */
export async function retroActionToTask(ctx: RequestContext, organizationId: string, companyId: string, itemId: string) {
  if (!isUuid(itemId)) throw notFound("Item");
  const item = await db().sprintRetroItem.findFirst({ where: { id: itemId, organizationId, companyId }, include: { sprint: { select: { projectId: true, name: true } } } });
  if (!item) throw notFound("Item");
  if (item.kind !== "ACTION") throw invalid("Only action items become tasks");
  if (item.taskId) throw conflict("A task already exists for this action", { reason: "work_retro_task_exists" });
  const task = await createWorkTask(ctx, organizationId, companyId, { projectId: item.sprint.projectId, title: item.text.slice(0, 300), labels: ["retro"], status: "TODO" });
  await db().sprintRetroItem.updateMany({ where: { id: itemId, taskId: null }, data: { taskId: task.id } });
  return task;
}

/** AI sprint analysis by the delivery analyst, attached to the sprint. */
export async function startSprintAi(ctx: RequestContext, organizationId: string, companyId: string, sprintId: string) {
  const s = await sprintOf(db(), organizationId, companyId, sprintId);
  const { chain } = await projectScope(db(), organizationId, companyId, s.projectId);
  await requirePermission(ctx, "projects.read", chain);
  return createAgentTask(ctx, organizationId, companyId, {
    profile: "delivery_analyst",
    title: `Sprint analysis: ${s.name}`.slice(0, 200),
    instructions: `Analyse this sprint with read_sprint (and read_team_workload for the project). Report: progress against the goal and committed points, burndown trend (ahead/behind the ideal line), scope changes, blocked or overdue tasks, overloaded people, likely carry-over, and 3–5 concrete recommendations. Propose risks with create_risk only for significant delivery threats not already registered.\n\nSprint id: ${sprintId}\nProject id: ${s.projectId}\nToday: ${dayString(today())}`,
    subject: { type: "sprint", id: sprintId },
  });
}
