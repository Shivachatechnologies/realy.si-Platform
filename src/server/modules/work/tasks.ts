import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { WorkPriority, WorkRecurrence, WorkTaskStatus } from "@/generated/prisma/enums";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers } from "@/server/modules/notifications/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";
import {
  actorId,
  addDays,
  addMonths,
  blank,
  day,
  eligibleUserIds,
  isUuid,
  oneOf,
  optDay,
  optText,
  optUuid,
  PAGE_SIZE,
  pageParam,
  param,
  projectScope,
  requireEligible,
  toDay,
  today,
  userNames,
  uuid,
} from "./shared";

export const TASK_STATUSES = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] as const;
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const RECURRENCES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
const OPEN = { notIn: ["DONE", "CANCELLED"] as WorkTaskStatus[] };
const STARTED: WorkTaskStatus[] = ["IN_PROGRESS", "IN_REVIEW", "DONE"];
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const labels = z.array(z.string().trim().min(1).max(40)).max(20);

export const createTaskInput = z.object({
  projectId: optUuid,
  parentId: optUuid,
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(20_000).optional(),
  status: z.enum(TASK_STATUSES).default("TODO"),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  assigneeId: optUuid,
  startDate: optDay,
  dueDate: optDay,
  estimatePoints: z.number().int().min(0).max(100).nullable().optional(),
  labels: labels.default([]),
  milestoneId: optUuid,
  sprintId: optUuid,
  featureId: optUuid,
  recurrence: z.enum(RECURRENCES).or(z.literal("")).nullable().optional(),
  recurrenceInterval: z.number().int().min(1).max(365).default(1),
  recurrenceUntil: optDay,
});

export const updateTaskInput = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: optText(20_000),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: optUuid,
  startDate: optDay,
  dueDate: optDay,
  estimatePoints: z.number().int().min(0).max(100).nullable().optional(),
  labels: labels.optional(),
  milestoneId: optUuid,
  sprintId: optUuid,
  featureId: optUuid,
  recurrence: z.enum(RECURRENCES).or(z.literal("")).nullable().optional(),
  recurrenceInterval: z.number().int().min(1).max(365).optional(),
  recurrenceUntil: optDay,
});

export const moveTaskInput = z.object({
  status: z.enum(TASK_STATUSES),
  /** Neighbours in the target column after the move (either may be absent). */
  beforeId: uuid.nullable().optional(),
  afterId: uuid.nullable().optional(),
});

export const dependencyInput = z.object({ dependsOnId: uuid });
export const commentInput = z.object({ body: z.string().trim().min(1).max(10_000), mentionIds: z.array(uuid).max(20).default([]) });
export const attachmentInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(120).regex(/^[\w.+-]+\/[\w.+-]+$/),
  /** Base64 file content (≤ 5 MB decoded). */
  data: z.string().min(1).max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8),
});
export const timeEntryInput = z.object({
  projectId: optUuid,
  taskId: optUuid,
  workDate: day,
  minutes: z.number().int().min(1).max(24 * 60),
  note: z.string().trim().max(500).optional(),
});

export interface TaskFilters {
  projectId?: string;
  q?: string;
  status?: WorkTaskStatus;
  open?: boolean;
  priority?: WorkPriority;
  assignee?: string;
  label?: string;
  sprint?: string;
  due?: "overdue" | "week" | "none";
  sort: "due" | "priority" | "created" | "title" | "status";
  dir: "asc" | "desc";
  page: number;
}

export function parseTaskFilters(raw: Record<string, string | string[] | undefined>): TaskFilters {
  const assignee = param(raw, "assignee");
  const sprint = param(raw, "sprint");
  const projectId = param(raw, "project");
  return {
    projectId: isUuid(projectId) ? projectId : undefined,
    q: param(raw, "q")?.slice(0, 200),
    status: oneOf(TASK_STATUSES, param(raw, "status")),
    open: param(raw, "open") === "1",
    priority: oneOf(PRIORITIES, param(raw, "priority")),
    assignee: assignee === "me" || assignee === "unassigned" || isUuid(assignee) ? assignee : undefined,
    label: param(raw, "label")?.slice(0, 40),
    sprint: sprint === "backlog" || isUuid(sprint) ? sprint : undefined,
    due: oneOf(["overdue", "week", "none"] as const, param(raw, "due")),
    sort: oneOf(["due", "priority", "created", "title", "status"] as const, param(raw, "sort")) ?? "due",
    dir: param(raw, "dir") === "desc" ? "desc" : "asc",
    page: pageParam(raw),
  };
}

const audit = (tx: Tx, ctx: RequestContext, organizationId: string, action: string, resourceId: string, newValue?: unknown, oldValue?: unknown, resourceType = "work_task") =>
  writeAudit(tx, ctx, { category: "TENANT", organizationId, action, resourceType, resourceId, newValue, oldValue });

/** Authorize against the task's project (project-scoped grants apply) or the company for tasks without a project. */
async function scopeFor(client: Tx | Db, organizationId: string, companyId: string, projectId: string | null) {
  const companyScope = await companyChain(client, organizationId, companyId);
  if (!projectId) return { chain: companyScope, project: null };
  const s = await projectScope(client, organizationId, companyId, projectId);
  return { chain: s.chain, project: s.project };
}

async function loadTask(client: Tx | Db, organizationId: string, companyId: string, taskId: string) {
  if (!isUuid(taskId)) throw notFound("Task");
  const t = await client.workTask.findFirst({ where: { id: taskId, organizationId, companyId, archivedAt: null } });
  if (!t) throw notFound("Task");
  return t;
}

async function authorizeTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string, permission: "projects.read" | "projects.manage", tx?: Tx) {
  const client = tx ?? db();
  await companyChain(client, organizationId, companyId);
  const task = await loadTask(client, organizationId, companyId, taskId);
  const { chain, project } = await scopeFor(client, organizationId, companyId, task.projectId);
  await requirePermission(ctx, permission, chain, tx);
  return { task, chain, project };
}

/** Validates references (same company, same project where it matters). */
async function checkRefs(
  tx: Tx,
  organizationId: string,
  companyId: string,
  chain: ScopeChain,
  projectId: string | null,
  refs: { parentId?: string | null; assigneeId?: string | null; milestoneId?: string | null; sprintId?: string | null; featureId?: string | null },
) {
  if (refs.parentId) {
    const parent = await tx.workTask.findFirst({ where: { id: refs.parentId, organizationId, companyId, archivedAt: null }, select: { projectId: true, parentId: true } });
    if (!parent) throw notFound("Parent task");
    if (parent.projectId !== projectId) throw invalid("A subtask must be in its parent's project", { reason: "work_parent_project" });
    if (parent.parentId) throw invalid("Subtasks can't have subtasks", { reason: "work_subtask_depth" });
  }
  if (refs.assigneeId) await requireEligible(tx, organizationId, chain, refs.assigneeId);
  if (refs.milestoneId) {
    const m = await tx.projectMilestone.findFirst({ where: { id: refs.milestoneId, organizationId, companyId }, select: { projectId: true } });
    if (!m || m.projectId !== projectId) throw notFound("Milestone");
  }
  if (refs.sprintId) {
    const s = await tx.sprint.findFirst({ where: { id: refs.sprintId, organizationId, companyId }, select: { projectId: true, status: true } });
    if (!s || s.projectId !== projectId) throw notFound("Sprint");
    if (s.status === "COMPLETED") throw conflict("The sprint is completed", { reason: "work_sprint_completed" });
  }
  if (refs.featureId && !(await tx.productFeature.findFirst({ where: { id: refs.featureId, organizationId, companyId }, select: { id: true } }))) throw notFound("Feature");
}

async function nextPosition(client: Tx | Db, companyId: string, projectId: string | null, status: WorkTaskStatus) {
  const last = await client.workTask.findFirst({ where: { companyId, projectId, status, archivedAt: null }, orderBy: { position: "desc" }, select: { position: true } });
  return (last?.position ?? 0) + 1;
}

/** Open finish-to-start predecessors of a task. */
async function openBlockers(client: Tx | Db, taskId: string) {
  const deps = await client.workTaskDependency.findMany({ where: { taskId, dependsOn: { status: OPEN, archivedAt: null } }, select: { dependsOn: { select: { id: true, title: true } } } });
  return deps.map((d) => d.dependsOn);
}

async function requireUnblocked(client: Tx | Db, taskId: string, status: WorkTaskStatus) {
  if (!STARTED.includes(status)) return;
  const blockers = await openBlockers(client, taskId);
  if (blockers.length) throw conflict("This task is waiting on unfinished tasks", { reason: "work_task_blocked", blockers: blockers.map((b) => b.title) });
}

function taskHref(t: { id: string }) {
  return `/projects/tasks/${t.id}`;
}

/** Next due date for a recurring task. */
export function nextOccurrence(from: Date, rule: WorkRecurrence, interval: number) {
  if (rule === "DAILY") return addDays(from, interval);
  if (rule === "WEEKLY") return addDays(from, 7 * interval);
  return addMonths(from, interval);
}

/**
 * Create the next occurrence of a recurring task once (guarded by recurrenceSpawnedAt). Called when the task is
 * completed and by the periodic job when an occurrence becomes due.
 */
export async function spawnNextOccurrence(tx: Tx, ctx: RequestContext, taskId: string) {
  const t = await tx.workTask.findUnique({ where: { id: taskId } });
  if (!t || !t.recurrence || t.recurrenceSpawnedAt || t.archivedAt) return null;
  const base = t.dueDate ?? t.startDate ?? today();
  const due = nextOccurrence(base, t.recurrence, t.recurrenceInterval);
  if (t.recurrenceUntil && due > t.recurrenceUntil) {
    await tx.workTask.update({ where: { id: t.id }, data: { recurrenceSpawnedAt: new Date() } });
    return null;
  }
  const claimed = await tx.workTask.updateMany({ where: { id: t.id, recurrenceSpawnedAt: null }, data: { recurrenceSpawnedAt: new Date() } });
  if (!claimed.count) return null;
  const shift = due.getTime() - base.getTime();
  const next = await tx.workTask.create({
    data: {
      organizationId: t.organizationId,
      companyId: t.companyId,
      projectId: t.projectId,
      title: t.title,
      description: t.description,
      status: "TODO",
      priority: t.priority,
      assigneeId: t.assigneeId,
      startDate: t.startDate ? new Date(t.startDate.getTime() + shift) : null,
      dueDate: due,
      estimatePoints: t.estimatePoints,
      labels: t.labels,
      milestoneId: null,
      featureId: t.featureId,
      recurrence: t.recurrence,
      recurrenceInterval: t.recurrenceInterval,
      recurrenceUntil: t.recurrenceUntil,
      sourceType: "recurrence",
      sourceId: t.id,
      position: await nextPosition(tx, t.companyId, t.projectId, "TODO"),
      createdById: t.createdById,
    },
  });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId: t.organizationId, action: "work_task.recurred", resourceType: "work_task", resourceId: next.id, newValue: { from: t.id, dueDate: due } });
  await emitDomainEvent(tx, ctx, "task.created", {
    organizationId: t.organizationId,
    companyId: t.companyId,
    entityType: "work_task",
    entityId: next.id,
    data: { title: next.title, projectId: next.projectId, assigneeId: next.assigneeId, dueDate: next.dueDate, priority: next.priority, recurring: true },
  });
  if (next.assigneeId) await notifyUsers(tx, t.organizationId, [next.assigneeId], "work.taskAssigned", { companyId: t.companyId, title: next.title, href: taskHref(next) });
  return next;
}

export async function createWorkTask(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createTaskInput>) {
  const input = createTaskInput.parse(raw);
  return transaction(async (tx) => {
    let projectId = blank(input.projectId) ?? null;
    const parentId = blank(input.parentId) ?? null;
    if (parentId && !projectId) {
      const parent = await tx.workTask.findFirst({ where: { id: parentId, organizationId, companyId }, select: { projectId: true } });
      projectId = parent?.projectId ?? null;
    }
    const { chain, project } = await scopeFor(tx, organizationId, companyId, projectId);
    await requirePermission(ctx, "projects.manage", chain, tx);
    if (project?.archivedAt) throw conflict("The project is archived", { reason: "work_project_archived" });
    const refs = { parentId, assigneeId: blank(input.assigneeId) ?? null, milestoneId: blank(input.milestoneId) ?? null, sprintId: blank(input.sprintId) ?? null, featureId: blank(input.featureId) ?? null };
    await checkRefs(tx, organizationId, companyId, chain, projectId, refs);
    const startDate = toDay(blank(input.startDate));
    const dueDate = toDay(blank(input.dueDate));
    if (startDate && dueDate && dueDate < startDate) throw invalid("The due date is before the start date", { reason: "work_dates_order" });
    const recurrence = (blank(input.recurrence) ?? null) as WorkRecurrence | null;
    if (recurrence && !dueDate) throw invalid("Recurring tasks need a due date", { reason: "work_recurrence_due" });
    const task = await tx.workTask.create({
      data: {
        organizationId,
        companyId,
        projectId,
        ...refs,
        title: input.title,
        description: input.description || null,
        status: input.status,
        priority: input.priority,
        startDate,
        dueDate,
        estimatePoints: input.estimatePoints ?? null,
        labels: [...new Set(input.labels)],
        recurrence,
        recurrenceInterval: input.recurrenceInterval,
        recurrenceUntil: toDay(blank(input.recurrenceUntil)),
        completedAt: input.status === "DONE" ? new Date() : null,
        position: await nextPosition(tx, companyId, projectId, input.status),
        createdById: actorId(ctx, organizationId),
      },
    });
    await audit(tx, ctx, organizationId, "work_task.created", task.id, { title: task.title, projectId, assigneeId: task.assigneeId });
    await emitDomainEvent(tx, ctx, "task.created", {
      organizationId,
      companyId,
      entityType: "work_task",
      entityId: task.id,
      data: { title: task.title, projectId, assigneeId: task.assigneeId, dueDate: task.dueDate, priority: task.priority, status: task.status },
    });
    if (task.assigneeId && task.assigneeId !== ctx.actor.id) await notifyUsers(tx, organizationId, [task.assigneeId], "work.taskAssigned", { companyId, title: task.title, href: taskHref(task) });
    return task;
  });
}

async function onCompleted(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, task: { id: string; title: string; projectId: string | null; assigneeId: string | null; dueDate: Date | null; createdById: string }) {
  await emitDomainEvent(tx, ctx, "task.completed", {
    organizationId,
    companyId,
    entityType: "work_task",
    entityId: task.id,
    data: { title: task.title, projectId: task.projectId, assigneeId: task.assigneeId, dueDate: task.dueDate, onTime: task.dueDate ? today() <= task.dueDate : null },
  });
  if (task.createdById !== ctx.actor.id && task.createdById !== task.assigneeId) {
    await notifyUsers(tx, organizationId, [task.createdById], "work.taskCompleted", { companyId, title: task.title, href: taskHref(task) });
  }
  await spawnNextOccurrence(tx, ctx, task.id);
}

export async function updateWorkTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string, raw: z.input<typeof updateTaskInput>) {
  const input = updateTaskInput.parse(raw);
  return transaction(async (tx) => {
    const { task: before, chain } = await authorizeTask(ctx, organizationId, companyId, taskId, "projects.manage", tx);
    const data: Prisma.WorkTaskUncheckedUpdateInput = {};
    const refs: Parameters<typeof checkRefs>[5] = {};
    if (input.assigneeId !== undefined) refs.assigneeId = data.assigneeId = blank(input.assigneeId) ?? null;
    if (input.milestoneId !== undefined) refs.milestoneId = data.milestoneId = blank(input.milestoneId) ?? null;
    if (input.sprintId !== undefined) refs.sprintId = data.sprintId = blank(input.sprintId) ?? null;
    if (input.featureId !== undefined) refs.featureId = data.featureId = blank(input.featureId) ?? null;
    await checkRefs(tx, organizationId, companyId, chain, before.projectId, refs);
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description || null;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.startDate !== undefined) data.startDate = toDay(blank(input.startDate));
    if (input.dueDate !== undefined) data.dueDate = toDay(blank(input.dueDate));
    if (input.estimatePoints !== undefined) data.estimatePoints = input.estimatePoints;
    if (input.labels !== undefined) data.labels = [...new Set(input.labels)];
    if (input.recurrence !== undefined) data.recurrence = (blank(input.recurrence) ?? null) as WorkRecurrence | null;
    if (input.recurrenceInterval !== undefined) data.recurrenceInterval = input.recurrenceInterval;
    if (input.recurrenceUntil !== undefined) data.recurrenceUntil = toDay(blank(input.recurrenceUntil));
    const start = data.startDate === undefined ? before.startDate : (data.startDate as Date | null);
    const due = data.dueDate === undefined ? before.dueDate : (data.dueDate as Date | null);
    if (start && due && due < start) throw invalid("The due date is before the start date", { reason: "work_dates_order" });
    const rec = data.recurrence === undefined ? before.recurrence : data.recurrence;
    if (rec && !due) throw invalid("Recurring tasks need a due date", { reason: "work_recurrence_due" });
    if (input.status !== undefined && input.status !== before.status) {
      await requireUnblocked(tx, taskId, input.status);
      data.status = input.status;
      data.completedAt = input.status === "DONE" ? new Date() : null;
      data.position = await nextPosition(tx, companyId, before.projectId, input.status);
    }
    const task = await tx.workTask.update({ where: { id: taskId }, data });
    await audit(tx, ctx, organizationId, "work_task.updated", taskId, input, { status: before.status, assigneeId: before.assigneeId });
    if (task.assigneeId && task.assigneeId !== before.assigneeId && task.assigneeId !== ctx.actor.id) {
      await notifyUsers(tx, organizationId, [task.assigneeId], "work.taskAssigned", { companyId, title: task.title, href: taskHref(task) });
    }
    if (task.status === "DONE" && before.status !== "DONE") await onCompleted(tx, ctx, organizationId, companyId, task);
    return task;
  });
}

/** Move a task on the board: new status and/or position between two neighbours. */
export async function moveWorkTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string, raw: z.input<typeof moveTaskInput>) {
  const input = moveTaskInput.parse(raw);
  return transaction(async (tx) => {
    const { task: before } = await authorizeTask(ctx, organizationId, companyId, taskId, "projects.manage", tx);
    if (input.status !== before.status) await requireUnblocked(tx, taskId, input.status);
    const neighbour = async (id?: string | null) =>
      id && id !== taskId ? tx.workTask.findFirst({ where: { id, companyId, projectId: before.projectId, archivedAt: null }, select: { position: true } }) : null;
    const [b, a] = await Promise.all([neighbour(input.beforeId), neighbour(input.afterId)]);
    let position: number;
    if (b && a) position = (b.position + a.position) / 2;
    else if (b) position = b.position + 1;
    else if (a) position = a.position - 1;
    else position = await nextPosition(tx, companyId, before.projectId, input.status);
    const task = await tx.workTask.update({
      where: { id: taskId },
      data: { status: input.status, position, ...(input.status !== before.status ? { completedAt: input.status === "DONE" ? new Date() : null } : {}) },
    });
    if (input.status !== before.status) {
      await audit(tx, ctx, organizationId, "work_task.moved", taskId, { status: input.status }, { status: before.status });
      if (task.status === "DONE") await onCompleted(tx, ctx, organizationId, companyId, task);
    }
    return task;
  });
}

export async function archiveWorkTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string) {
  return transaction(async (tx) => {
    const { task } = await authorizeTask(ctx, organizationId, companyId, taskId, "projects.manage", tx);
    const now = new Date();
    await tx.workTask.updateMany({ where: { companyId, OR: [{ id: taskId }, { parentId: taskId }] }, data: { archivedAt: now } });
    await audit(tx, ctx, organizationId, "work_task.archived", taskId, undefined, { title: task.title });
    return { ok: true, projectId: task.projectId };
  });
}

function taskWhere(ctx: RequestContext, organizationId: string, companyId: string, f: TaskFilters): Prisma.WorkTaskWhereInput {
  const where: Prisma.WorkTaskWhereInput = { organizationId, companyId, archivedAt: null };
  if (f.projectId) where.projectId = f.projectId;
  if (f.status) where.status = f.status;
  else if (f.open) where.status = OPEN;
  if (f.priority) where.priority = f.priority;
  if (f.assignee === "me") where.assigneeId = ctx.actor.id ?? "00000000-0000-0000-0000-000000000000";
  else if (f.assignee === "unassigned") where.assigneeId = null;
  else if (f.assignee) where.assigneeId = f.assignee;
  if (f.label) where.labels = { has: f.label };
  if (f.sprint === "backlog") where.sprintId = null;
  else if (f.sprint) where.sprintId = f.sprint;
  const now = today();
  if (f.due === "overdue") Object.assign(where, { dueDate: { lt: now }, status: f.status ?? OPEN });
  else if (f.due === "week") where.dueDate = { gte: now, lt: addDays(now, 7) };
  else if (f.due === "none") where.dueDate = null;
  if (f.q) where.OR = [{ title: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }, { labels: { has: f.q } }];
  return where;
}

const PRIORITY_RANK: Record<WorkPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export const taskListSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  startDate: true,
  dueDate: true,
  completedAt: true,
  estimatePoints: true,
  labels: true,
  position: true,
  projectId: true,
  parentId: true,
  sprintId: true,
  milestoneId: true,
  recurrence: true,
  assignee: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  _count: { select: { subtasks: true, comments: true, attachments: true, dependsOn: true } },
} satisfies Prisma.WorkTaskSelect;

/** Paginated, filtered task list (company-wide or one project). Requires projects.read at the company. */
export async function listWorkTasks(ctx: RequestContext, organizationId: string, companyId: string, filters: TaskFilters) {
  if (filters.projectId) {
    const s = await projectScope(db(), organizationId, companyId, filters.projectId);
    await companyChain(db(), organizationId, companyId);
    await requirePermission(ctx, "projects.read", s.chain);
  } else {
    await requirePermission(ctx, "projects.read", await companyChain(db(), organizationId, companyId));
  }
  const where = taskWhere(ctx, organizationId, companyId, filters);
  const dir = filters.dir;
  const orderBy: Prisma.WorkTaskOrderByWithRelationInput[] =
    filters.sort === "title"
      ? [{ title: dir }]
      : filters.sort === "created"
        ? [{ createdAt: dir }]
        : filters.sort === "status"
          ? [{ status: dir }, { position: "asc" }]
          : filters.sort === "priority"
            ? [{ priority: dir === "asc" ? "desc" : "asc" }, { dueDate: { sort: "asc", nulls: "last" } }]
            : [{ dueDate: { sort: dir, nulls: "last" } }, { createdAt: "asc" }];
  const [total, rows] = await Promise.all([
    db().workTask.count({ where }),
    db().workTask.findMany({ where, orderBy, skip: (filters.page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: taskListSelect }),
  ]);
  // Prisma sorts enums by declaration order (LOW…URGENT); keep URGENT first on "priority asc".
  if (filters.sort === "priority") rows.sort((a, b) => (dir === "asc" ? 1 : -1) * (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]));
  return { data: rows, total, page: filters.page, pageSize: PAGE_SIZE };
}

/** All open + recently done top-level tasks of a project (or one sprint), for the Kanban board. */
export async function boardTasks(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, opts: { sprintId?: string; assignee?: string; q?: string } = {}) {
  const s = await projectScope(db(), organizationId, companyId, projectId);
  await requirePermission(ctx, "projects.read", s.chain);
  const where: Prisma.WorkTaskWhereInput = {
    organizationId,
    companyId,
    projectId,
    archivedAt: null,
    parentId: null,
    OR: [{ status: OPEN }, { completedAt: { gte: addDays(new Date(), -30) } }, { status: "CANCELLED", updatedAt: { gte: addDays(new Date(), -7) } }],
  };
  if (opts.sprintId) where.sprintId = opts.sprintId;
  if (opts.assignee === "me") where.assigneeId = ctx.actor.id ?? "00000000-0000-0000-0000-000000000000";
  else if (isUuid(opts.assignee)) where.assigneeId = opts.assignee;
  if (opts.q) where.title = { contains: opts.q.slice(0, 200), mode: "insensitive" };
  const tasks = await db().workTask.findMany({ where, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 1000, select: taskListSelect });
  const blocked = await db().workTaskDependency.findMany({ where: { taskId: { in: tasks.map((t) => t.id) }, dependsOn: { status: OPEN, archivedAt: null } }, select: { taskId: true } });
  const blockedIds = new Set(blocked.map((b) => b.taskId));
  return tasks.map((t) => ({ ...t, blocked: blockedIds.has(t.id) }));
}

/** Tasks with a due date in [from, to) for the calendar (one project, or the viewer's own tasks). */
export async function calendarTasks(ctx: RequestContext, organizationId: string, companyId: string, range: { from: Date; to: Date }, scope: { projectId?: string; mine?: boolean }) {
  if (scope.projectId) {
    const s = await projectScope(db(), organizationId, companyId, scope.projectId);
    await requirePermission(ctx, "projects.read", s.chain);
  } else await requirePermission(ctx, "projects.read", await companyChain(db(), organizationId, companyId));
  return db().workTask.findMany({
    where: {
      organizationId,
      companyId,
      archivedAt: null,
      dueDate: { gte: range.from, lt: range.to },
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
      ...(scope.mine ? { assigneeId: ctx.actor.id ?? "00000000-0000-0000-0000-000000000000" } : {}),
    },
    orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
    take: 1000,
    select: taskListSelect,
  });
}

/** Tasks for the timeline (Gantt) view: top-level tasks with a start or due date. */
export async function timelineTasks(ctx: RequestContext, organizationId: string, companyId: string, projectId: string) {
  const s = await projectScope(db(), organizationId, companyId, projectId);
  await requirePermission(ctx, "projects.read", s.chain);
  const [tasks, deps] = await Promise.all([
    db().workTask.findMany({
      where: { organizationId, companyId, projectId, archivedAt: null, parentId: null, status: { not: "CANCELLED" }, OR: [{ startDate: { not: null } }, { dueDate: { not: null } }] },
      orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { dueDate: "asc" }],
      take: 300,
      select: taskListSelect,
    }),
    db().workTaskDependency.findMany({ where: { companyId, task: { projectId } }, select: { taskId: true, dependsOnId: true } }),
  ]);
  return { tasks, deps };
}

/** The viewer's open tasks across projects, grouped by urgency, plus recently completed. */
export async function myTasks(ctx: RequestContext, organizationId: string, companyId: string) {
  await requirePermission(ctx, "projects.read", await companyChain(db(), organizationId, companyId));
  const me = ctx.actor.id ?? "00000000-0000-0000-0000-000000000000";
  const [open, done] = await Promise.all([
    db().workTask.findMany({ where: { organizationId, companyId, archivedAt: null, assigneeId: me, status: OPEN }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }], take: 500, select: taskListSelect }),
    db().workTask.findMany({ where: { organizationId, companyId, archivedAt: null, assigneeId: me, status: "DONE", completedAt: { gte: addDays(new Date(), -14) } }, orderBy: { completedAt: "desc" }, take: 50, select: taskListSelect }),
  ]);
  const now = today();
  const week = addDays(now, 7);
  return {
    overdue: open.filter((t) => t.dueDate && t.dueDate < now),
    today: open.filter((t) => t.dueDate && t.dueDate.getTime() === now.getTime()),
    week: open.filter((t) => t.dueDate && t.dueDate > now && t.dueDate < week),
    later: open.filter((t) => !t.dueDate || t.dueDate >= week),
    done,
  };
}

export async function getWorkTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string) {
  const { task } = await authorizeTask(ctx, organizationId, companyId, taskId, "projects.read");
  const full = await db().workTask.findFirstOrThrow({
    where: { id: task.id },
    include: {
      assignee: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, currency: true } },
      parent: { select: { id: true, title: true } },
      sprint: { select: { id: true, name: true, status: true } },
      milestone: { select: { id: true, title: true } },
      feature: { select: { id: true, title: true } },
      subtasks: { where: { archivedAt: null }, orderBy: { position: "asc" }, select: { id: true, title: true, status: true, assignee: { select: { id: true, name: true } }, dueDate: true } },
      dependsOn: { select: { id: true, dependsOn: { select: { id: true, title: true, status: true } } } },
      blocks: { select: { id: true, task: { select: { id: true, title: true, status: true } } } },
      comments: { orderBy: { createdAt: "asc" }, take: 500 },
      attachments: { orderBy: { createdAt: "desc" }, select: { id: true, fileName: true, contentType: true, sizeBytes: true, uploadedById: true, createdAt: true } },
      timeEntries: { orderBy: { workDate: "desc" }, take: 200 },
    },
  });
  const names = await userNames(db(), [full.createdById, ...full.comments.map((c) => c.authorId), ...full.timeEntries.map((e) => e.userId), ...full.attachments.map((a) => a.uploadedById)]);
  return {
    ...full,
    createdByName: names.get(full.createdById) ?? null,
    comments: full.comments.map((c) => ({ ...c, authorName: names.get(c.authorId) ?? null })),
    timeEntries: full.timeEntries.map((e) => ({ ...e, userName: names.get(e.userId) ?? null })),
    attachments: full.attachments.map((a) => ({ ...a, uploadedByName: names.get(a.uploadedById) ?? null })),
    loggedMinutes: full.timeEntries.reduce((n, e) => n + e.minutes, 0),
    blocked: full.dependsOn.some((d) => d.dependsOn.status !== "DONE" && d.dependsOn.status !== "CANCELLED"),
  };
}

// ─── Dependencies ───

/** True if `from` can reach `target` following dependsOn edges (adding target → from would close a cycle). */
async function reaches(client: Tx | Db, companyId: string, from: string, target: string) {
  const seen = new Set<string>([from]);
  let frontier = [from];
  while (frontier.length) {
    if (seen.size > 5000) return true;
    const edges = await client.workTaskDependency.findMany({ where: { companyId, taskId: { in: frontier } }, select: { dependsOnId: true } });
    const next: string[] = [];
    for (const e of edges) {
      if (e.dependsOnId === target) return true;
      if (!seen.has(e.dependsOnId)) {
        seen.add(e.dependsOnId);
        next.push(e.dependsOnId);
      }
    }
    frontier = next;
  }
  return false;
}

export async function addDependency(ctx: RequestContext, organizationId: string, companyId: string, taskId: string, raw: z.input<typeof dependencyInput>) {
  const { dependsOnId } = dependencyInput.parse(raw);
  return transaction(async (tx) => {
    const { task } = await authorizeTask(ctx, organizationId, companyId, taskId, "projects.manage", tx);
    if (dependsOnId === taskId) throw invalid("A task can't depend on itself", { reason: "work_dependency_cycle" });
    const other = await loadTask(tx, organizationId, companyId, dependsOnId);
    if (other.projectId !== task.projectId) throw invalid("Dependencies must be in the same project", { reason: "work_dependency_project" });
    if (await reaches(tx, companyId, dependsOnId, taskId)) throw conflict("That would create a dependency cycle", { reason: "work_dependency_cycle" });
    const existing = await tx.workTaskDependency.findUnique({ where: { taskId_dependsOnId: { taskId, dependsOnId } } });
    if (existing) return existing;
    const d = await tx.workTaskDependency.create({ data: { organizationId, companyId, taskId, dependsOnId } });
    await audit(tx, ctx, organizationId, "work_task.dependency_added", taskId, { dependsOnId });
    return d;
  });
}

export async function removeDependency(ctx: RequestContext, organizationId: string, companyId: string, taskId: string, dependsOnId: string) {
  return transaction(async (tx) => {
    await authorizeTask(ctx, organizationId, companyId, taskId, "projects.manage", tx);
    if (!isUuid(dependsOnId)) throw notFound("Dependency");
    const { count } = await tx.workTaskDependency.deleteMany({ where: { taskId, dependsOnId, companyId } });
    if (!count) throw notFound("Dependency");
    await audit(tx, ctx, organizationId, "work_task.dependency_removed", taskId, { dependsOnId });
    return { ok: true };
  });
}

// ─── Comments ───

/** Comment on a task; @mentioned users (who can see projects) are notified, as are assignee and creator. */
export async function addComment(ctx: RequestContext, organizationId: string, companyId: string, taskId: string, raw: z.input<typeof commentInput>) {
  const input = commentInput.parse(raw);
  return transaction(async (tx) => {
    const { task, chain } = await authorizeTask(ctx, organizationId, companyId, taskId, "projects.read", tx);
    const mentionIds = input.mentionIds.length ? await eligibleUserIds(tx, organizationId, chain, "projects.read", [...new Set(input.mentionIds)]) : [];
    const c = await tx.workTaskComment.create({ data: { organizationId, companyId, taskId, authorId: actorId(ctx, organizationId), body: input.body, mentionIds } });
    await audit(tx, ctx, organizationId, "work_task.commented", taskId, { commentId: c.id, mentions: mentionIds.length });
    const me = ctx.actor.id;
    await notifyUsers(tx, organizationId, mentionIds.filter((id) => id !== me), "work.mentioned", { companyId, title: task.title, href: taskHref(task) });
    const watchers = [task.assigneeId, task.createdById].filter((id) => id && id !== me && !mentionIds.includes(id));
    await notifyUsers(tx, organizationId, watchers, "work.taskComment", { companyId, title: task.title, href: taskHref(task) });
    return c;
  });
}

export async function deleteComment(ctx: RequestContext, organizationId: string, companyId: string, commentId: string) {
  return transaction(async (tx) => {
    if (!isUuid(commentId)) throw notFound("Comment");
    const c = await tx.workTaskComment.findFirst({ where: { id: commentId, organizationId, companyId } });
    if (!c) throw notFound("Comment");
    await authorizeTask(ctx, organizationId, companyId, c.taskId, c.authorId === ctx.actor.id ? "projects.read" : "projects.manage", tx);
    await tx.workTaskComment.delete({ where: { id: commentId } });
    await audit(tx, ctx, organizationId, "work_task.comment_deleted", c.taskId, { commentId });
    return { ok: true };
  });
}

// ─── Attachments ───

export async function addAttachment(ctx: RequestContext, organizationId: string, companyId: string, taskId: string, raw: z.input<typeof attachmentInput>) {
  const input = attachmentInput.parse(raw);
  const bytes = Buffer.from(input.data, "base64");
  if (!bytes.length) throw invalid("Empty file");
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw invalid("The file is larger than 5 MB", { reason: "work_attachment_too_large" });
  return transaction(async (tx) => {
    await authorizeTask(ctx, organizationId, companyId, taskId, "projects.manage", tx);
    const a = await tx.workTaskAttachment.create({
      data: { organizationId, companyId, taskId, fileName: input.fileName.replace(/[\r\n"\\/]/g, "_"), contentType: input.contentType, sizeBytes: bytes.length, data: bytes, uploadedById: actorId(ctx, organizationId) },
      select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
    });
    await audit(tx, ctx, organizationId, "work_task.attachment_added", taskId, { attachmentId: a.id, fileName: a.fileName, sizeBytes: a.sizeBytes });
    return a;
  });
}

/** Attachment content; requires projects.read on the task's project. */
export async function getAttachment(ctx: RequestContext, organizationId: string, companyId: string, attachmentId: string) {
  if (!isUuid(attachmentId)) throw notFound("Attachment");
  await companyChain(db(), organizationId, companyId);
  const a = await db().workTaskAttachment.findFirst({ where: { id: attachmentId, organizationId, companyId } });
  if (!a) throw notFound("Attachment");
  await authorizeTask(ctx, organizationId, companyId, a.taskId, "projects.read");
  return a;
}

export async function deleteAttachment(ctx: RequestContext, organizationId: string, companyId: string, attachmentId: string) {
  return transaction(async (tx) => {
    if (!isUuid(attachmentId)) throw notFound("Attachment");
    const a = await tx.workTaskAttachment.findFirst({ where: { id: attachmentId, organizationId, companyId }, select: { id: true, taskId: true, fileName: true } });
    if (!a) throw notFound("Attachment");
    await authorizeTask(ctx, organizationId, companyId, a.taskId, "projects.manage", tx);
    await tx.workTaskAttachment.delete({ where: { id: a.id } });
    await audit(tx, ctx, organizationId, "work_task.attachment_deleted", a.taskId, { attachmentId: a.id, fileName: a.fileName });
    return { ok: true };
  });
}

// ─── Time tracking ───

/** Log time on a task or project. The member's hourly rate is captured for budget tracking. */
export async function logTime(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof timeEntryInput>) {
  const input = timeEntryInput.parse(raw);
  return transaction(async (tx) => {
    let projectId = blank(input.projectId) ?? null;
    const taskId = blank(input.taskId) ?? null;
    if (taskId) {
      const { task } = await authorizeTask(ctx, organizationId, companyId, taskId, "projects.read", tx);
      if (!task.projectId) throw invalid("Time can only be logged on project tasks", { reason: "work_time_no_project" });
      projectId = task.projectId;
    }
    if (!projectId) throw invalid("Choose a project or task");
    const { chain } = await projectScope(tx, organizationId, companyId, projectId);
    await requirePermission(ctx, "projects.read", chain, tx);
    const userId = ctx.actor.id;
    if (!userId || ctx.actor.type !== "USER") throw forbidden("Only people can log time");
    if (toDay(input.workDate)! > addDays(today(), 1)) throw invalid("Time can't be logged in the future", { reason: "work_time_future" });
    const member = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { hourlyRateMinor: true } });
    const e = await tx.workTimeEntry.create({
      data: { organizationId, companyId, projectId, taskId, userId, workDate: toDay(input.workDate)!, minutes: input.minutes, note: input.note || null, rateMinor: member?.hourlyRateMinor ?? null },
    });
    await audit(tx, ctx, organizationId, "work_time.logged", e.id, { projectId, taskId, minutes: e.minutes }, undefined, "work_time_entry");
    return e;
  });
}

export async function deleteTimeEntry(ctx: RequestContext, organizationId: string, companyId: string, entryId: string) {
  return transaction(async (tx) => {
    if (!isUuid(entryId)) throw notFound("Time entry");
    const e = await tx.workTimeEntry.findFirst({ where: { id: entryId, organizationId, companyId } });
    if (!e) throw notFound("Time entry");
    const { chain } = await projectScope(tx, organizationId, companyId, e.projectId);
    await requirePermission(ctx, e.userId === ctx.actor.id ? "projects.read" : "projects.manage", chain, tx);
    await tx.workTimeEntry.delete({ where: { id: entryId } });
    await audit(tx, ctx, organizationId, "work_time.deleted", entryId, undefined, { minutes: e.minutes }, "work_time_entry");
    return { ok: true };
  });
}

/** Open work per person (count, points, overdue) — for workload views and AI allocation. */
export async function workload(ctx: RequestContext, organizationId: string, companyId: string, opts: { projectId?: string; userId?: string } = {}) {
  if (opts.projectId) {
    const s = await projectScope(db(), organizationId, companyId, opts.projectId);
    await requirePermission(ctx, "projects.read", s.chain);
  } else await requirePermission(ctx, "projects.read", await companyChain(db(), organizationId, companyId));
  const where: Prisma.WorkTaskWhereInput = { organizationId, companyId, archivedAt: null, status: OPEN, assigneeId: opts.userId ? opts.userId : { not: null }, ...(opts.projectId ? { projectId: opts.projectId } : {}) };
  const [counts, points, overdue] = await Promise.all([
    db().workTask.groupBy({ by: ["assigneeId"], where, _count: { _all: true } }),
    db().workTask.groupBy({ by: ["assigneeId"], where, _sum: { estimatePoints: true } }),
    db().workTask.groupBy({ by: ["assigneeId"], where: { ...where, dueDate: { lt: today() } }, _count: { _all: true } }),
  ]);
  const names = await userNames(db(), counts.map((c) => c.assigneeId));
  return counts
    .map((c) => ({
      userId: c.assigneeId!,
      name: names.get(c.assigneeId!) ?? "?",
      open: c._count._all,
      points: points.find((p) => p.assigneeId === c.assigneeId)?._sum.estimatePoints ?? 0,
      overdue: overdue.find((o) => o.assigneeId === c.assigneeId)?._count._all ?? 0,
    }))
    .sort((a, b) => b.open - a.open);
}

/** Distinct labels used in a company's (or project's) tasks, for filters. */
export async function taskLabels(organizationId: string, companyId: string, projectId?: string) {
  const rows = await db().workTask.findMany({ where: { organizationId, companyId, archivedAt: null, ...(projectId ? { projectId } : {}), NOT: { labels: { isEmpty: true } } }, select: { labels: true }, take: 2000 });
  return [...new Set(rows.flatMap((r) => r.labels))].sort().slice(0, 100);
}
