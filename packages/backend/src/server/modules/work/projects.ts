import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ProjectHealth, ProjectRiskStatus, ProjectStatus } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers } from "@/server/modules/notifications/service";
import { createTask as createAgentTask } from "@/server/modules/agents/service";
import {
  actorId,
  addDays,
  authorize,
  authorizeProject,
  blank,
  day,
  dayString,
  isUuid,
  oneOf,
  optDay,
  optMoney,
  optText,
  optUuid,
  PAGE_SIZE,
  pageParam,
  param,
  requireEligible,
  toDay,
  today,
  toMinor,
  userNames,
  uuid,
} from "./shared";
import { BUILT_IN_KEYS, BUILT_IN_TEMPLATES, blueprintSchema, type Blueprint } from "./templates";

export const PROJECT_STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
export const PROJECT_HEALTH = ["ON_TRACK", "AT_RISK", "OFF_TRACK"] as const;
export const RISK_STATUSES = ["OPEN", "MITIGATING", "CLOSED", "OCCURRED"] as const;
const OPEN_TASK = { notIn: ["DONE", "CANCELLED"] } as { notIn: ("DONE" | "CANCELLED")[] };
export const openTaskStatus = OPEN_TASK;

export const createProjectInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(5000).optional(),
  /** Defaults to the company's first workspace. */
  workspaceId: uuid.optional().or(z.literal("").transform(() => undefined)),
  status: z.enum(PROJECT_STATUSES).default("PLANNED"),
  ownerId: optUuid,
  startDate: optDay,
  dueDate: optDay,
  budget: optMoney,
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  /** Built-in template key or the id of a saved template. */
  template: z.string().max(60).optional(),
  memberIds: z.array(uuid).max(100).default([]),
});

export const updateProjectInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: optText(5000),
  status: z.enum(PROJECT_STATUSES).optional(),
  health: z.enum(PROJECT_HEALTH).optional(),
  ownerId: optUuid,
  startDate: optDay,
  dueDate: optDay,
  budget: optMoney,
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  archived: z.boolean().optional(),
});

export const memberInput = z.object({
  userId: uuid,
  role: z.string().trim().max(80).optional(),
  hourlyRate: optMoney,
});

export const milestoneInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: optText(2000),
  dueDate: optDay,
  done: z.boolean().optional(),
});
export const updateMilestoneInput = milestoneInput.partial();

export const riskInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: optText(4000),
  probability: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  mitigation: optText(4000),
  ownerId: optUuid,
  status: z.enum(RISK_STATUSES).default("OPEN"),
});
export const updateRiskInput = riskInput.partial();

export const expenseInput = z.object({
  description: z.string().trim().min(1).max(300),
  amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/),
  incurredOn: day,
});

export const saveTemplateInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).optional() });

export const PROJECT_AI_ACTIONS = ["status_report", "detect_risks", "plan"] as const;
export const projectAiInput = z.object({ action: z.enum(PROJECT_AI_ACTIONS) });

export interface ProjectFilters {
  q?: string;
  status?: ProjectStatus;
  owner?: string;
  archived?: boolean;
  sort: "created" | "name" | "due" | "status";
  page: number;
}

export function parseProjectFilters(raw: Record<string, string | string[] | undefined>): ProjectFilters {
  const owner = param(raw, "owner");
  return {
    q: param(raw, "q")?.slice(0, 200),
    status: oneOf(PROJECT_STATUSES, param(raw, "status")),
    owner: owner === "me" || isUuid(owner) ? owner : undefined,
    archived: param(raw, "archived") === "1",
    sort: oneOf(["created", "name", "due", "status"] as const, param(raw, "sort")) ?? "created",
    page: pageParam(raw),
  };
}

const audit = (tx: Tx, ctx: RequestContext, organizationId: string, action: string, resourceType: string, resourceId: string, newValue?: unknown, oldValue?: unknown) =>
  writeAudit(tx, ctx, { category: "TENANT", organizationId, action, resourceType, resourceId, newValue, oldValue });

/** Create milestones and tasks from a blueprint, placed relative to `start`. */
export async function applyBlueprint(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, projectId: string, blueprint: Blueprint, start: Date) {
  const milestoneIds = new Map<string, string>();
  for (const m of blueprint.milestones) {
    const row = await tx.projectMilestone.create({ data: { organizationId, companyId, projectId, title: m.title, dueDate: addDays(start, m.offsetDays) } });
    milestoneIds.set(m.title, row.id);
  }
  const taskIds: string[] = [];
  let position = 1;
  for (const t of blueprint.tasks) {
    const row = await tx.workTask.create({
      data: {
        organizationId,
        companyId,
        projectId,
        title: t.title,
        description: t.description ?? null,
        priority: t.priority,
        status: "TODO",
        startDate: addDays(start, t.offsetDays),
        dueDate: addDays(start, t.offsetDays + Math.max(t.durationDays - 1, 0)),
        estimatePoints: t.points ?? null,
        labels: t.labels,
        milestoneId: t.milestone ? (milestoneIds.get(t.milestone) ?? null) : null,
        position: position++,
        createdById: actorId(ctx, organizationId),
      },
      select: { id: true },
    });
    taskIds.push(row.id);
  }
  for (const [i, t] of blueprint.tasks.entries()) {
    if (t.after === undefined || t.after === i || !taskIds[t.after]) continue;
    await tx.workTaskDependency.create({ data: { organizationId, companyId, taskId: taskIds[i]!, dependsOnId: taskIds[t.after]! } });
  }
  return { milestones: milestoneIds.size, tasks: taskIds.length };
}

async function loadBlueprint(tx: Tx, organizationId: string, companyId: string, template: string): Promise<{ key: string; blueprint: Blueprint }> {
  const builtIn = BUILT_IN_TEMPLATES.find((b) => b.key === template);
  if (builtIn) return { key: builtIn.key, blueprint: builtIn.blueprint };
  if (!isUuid(template)) throw notFound("Template");
  const row = await tx.projectTemplate.findFirst({ where: { id: template, organizationId, companyId } });
  if (!row) throw notFound("Template");
  return { key: `custom:${row.id}`, blueprint: blueprintSchema.parse(row.blueprint) };
}

/** Create a project (optionally from a template), with owner and members. Emits project.created. */
export async function createWorkProject(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createProjectInput>) {
  const input = createProjectInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
    const workspace = input.workspaceId
      ? await tx.workspace.findFirst({ where: { id: input.workspaceId, organizationId, companyId }, select: { id: true } })
      : await tx.workspace.findFirst({ where: { organizationId, companyId }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!workspace) throw notFound("Workspace");
    const ownerId = blank(input.ownerId) ?? ctx.actor.id ?? null;
    if (ownerId && ownerId !== ctx.actor.id) await requireEligible(tx, organizationId, chain, ownerId);
    for (const m of input.memberIds) await requireEligible(tx, organizationId, chain, m);
    const start = toDay(blank(input.startDate)) ?? today();
    const tpl = input.template && input.template !== "blank" ? await loadBlueprint(tx, organizationId, companyId, input.template) : null;
    const project = await tx.project.create({
      data: {
        organizationId,
        companyId,
        workspaceId: workspace.id,
        name: input.name,
        description: input.description || null,
        status: input.status,
        ownerId,
        startDate: toDay(blank(input.startDate)) ?? (tpl ? start : null),
        dueDate: toDay(blank(input.dueDate)),
        budgetMinor: toMinor(blank(input.budget)),
        currency: input.currency ?? company.baseCurrency,
        templateKey: tpl?.key ?? null,
        createdById: ctx.actor.id ?? null,
      },
    });
    const memberIds = [...new Set([...(ownerId ? [ownerId] : []), ...input.memberIds])];
    if (memberIds.length) await tx.projectMember.createMany({ data: memberIds.map((userId) => ({ organizationId, companyId, projectId: project.id, userId, role: userId === ownerId ? "Owner" : null })) });
    const applied = tpl ? await applyBlueprint(tx, ctx, organizationId, companyId, project.id, tpl.blueprint, start) : null;
    await audit(tx, ctx, organizationId, "project.created", "project", project.id, { name: project.name, template: tpl?.key ?? null, ...applied });
    await emitDomainEvent(tx, ctx, "project.created", {
      organizationId,
      companyId,
      entityType: "project",
      entityId: project.id,
      data: { name: project.name, status: project.status, ownerId: project.ownerId, template: tpl?.key ?? null, dueDate: project.dueDate },
    });
    return project;
  });
}

function projectWhere(ctx: RequestContext, organizationId: string, companyId: string, f: ProjectFilters): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = { organizationId, companyId, archivedAt: f.archived ? { not: null } : null };
  if (f.status) where.status = f.status;
  if (f.owner === "me") where.ownerId = ctx.actor.id ?? "00000000-0000-0000-0000-000000000000";
  else if (f.owner) where.ownerId = f.owner;
  if (f.q) where.OR = [{ name: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }];
  return where;
}

/** Projects with progress (done/total tasks), overdue counts and open risks. */
export async function listWorkProjects(ctx: RequestContext, organizationId: string, companyId: string, filters: ProjectFilters = { sort: "created", page: 1 }) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const where = projectWhere(ctx, organizationId, companyId, filters);
  const orderBy: Prisma.ProjectOrderByWithRelationInput[] =
    filters.sort === "name" ? [{ name: "asc" }] : filters.sort === "due" ? [{ dueDate: { sort: "asc", nulls: "last" } }] : filters.sort === "status" ? [{ status: "asc" }, { name: "asc" }] : [{ createdAt: "desc" }];
  const [total, rows] = await Promise.all([
    db().project.count({ where }),
    db().project.findMany({
      where,
      orderBy,
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { owner: { select: { id: true, name: true } }, workspace: { select: { id: true, name: true } }, _count: { select: { members: true } } },
    }),
  ]);
  const ids = rows.map((r) => r.id);
  const now = today();
  const [byStatus, overdue, risks] = ids.length
    ? await Promise.all([
        db().workTask.groupBy({ by: ["projectId", "status"], where: { projectId: { in: ids }, archivedAt: null, parentId: null }, _count: { _all: true } }),
        db().workTask.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, archivedAt: null, status: OPEN_TASK, dueDate: { lt: now } }, _count: { _all: true } }),
        db().projectRisk.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, status: { in: ["OPEN", "MITIGATING"] } }, _count: { _all: true } }),
      ])
    : [[], [], []];
  return {
    total,
    page: filters.page,
    pageSize: PAGE_SIZE,
    data: rows.map((p) => {
      const counts = byStatus.filter((s) => s.projectId === p.id);
      const all = counts.filter((c) => c.status !== "CANCELLED").reduce((n, c) => n + c._count._all, 0);
      const done = counts.find((c) => c.status === "DONE")?._count._all ?? 0;
      return {
        ...p,
        tasksTotal: all,
        tasksDone: done,
        progress: all ? Math.round((done / all) * 100) : 0,
        overdue: overdue.find((o) => o.projectId === p.id)?._count._all ?? 0,
        openRisks: risks.find((r) => r.projectId === p.id)?._count._all ?? 0,
      };
    }),
  };
}

/** Budget vs logged cost: time (minutes × rate captured at logging) + expenses, in the project currency. */
export async function budgetSummary(projectId: string, budgetMinor: bigint | null) {
  const [entries, expenses] = await Promise.all([
    // Grouped by rate (exact): time entries grow without bound over a project's life.
    db().workTimeEntry.groupBy({ by: ["rateMinor"], where: { projectId }, _sum: { minutes: true } }),
    db().projectExpense.aggregate({ where: { projectId }, _sum: { amountMinor: true } }),
  ]);
  const minutes = entries.reduce((n, e) => n + (e._sum.minutes ?? 0), 0);
  const timeCostMinor = entries.reduce((n, e) => n + (e.rateMinor ? (e.rateMinor * BigInt(e._sum.minutes ?? 0)) / 60n : 0n), 0n);
  const expenseMinor = expenses._sum.amountMinor ?? 0n;
  const spentMinor = timeCostMinor + expenseMinor;
  return {
    budgetMinor,
    minutes,
    timeCostMinor,
    expenseMinor,
    spentMinor,
    remainingMinor: budgetMinor != null ? budgetMinor - spentMinor : null,
    usedPercent: budgetMinor && budgetMinor > 0n ? Number((spentMinor * 1000n) / budgetMinor) / 10 : null,
  };
}

/** Health suggested from the data: overdue work, missed due date, high-exposure risks, budget overrun. */
export function suggestHealth(input: { dueDate: Date | null; status: ProjectStatus; openTasks: number; overdueTasks: number; highRisks: number; usedPercent: number | null }): ProjectHealth {
  if (input.status === "COMPLETED" || input.status === "CANCELLED") return "ON_TRACK";
  const late = input.dueDate && input.dueDate < today();
  if (late || (input.openTasks > 0 && input.overdueTasks / input.openTasks > 0.25) || (input.usedPercent ?? 0) > 110) return "OFF_TRACK";
  if (input.overdueTasks > 0 || input.highRisks > 0 || (input.usedPercent ?? 0) > 90) return "AT_RISK";
  return "ON_TRACK";
}

export async function getWorkProject(ctx: RequestContext, organizationId: string, companyId: string, projectId: string) {
  await authorizeProject(ctx, organizationId, companyId, projectId, "projects.read");
  const p = await db().project.findFirst({
    where: { id: projectId, organizationId, companyId },
    include: {
      owner: { select: { id: true, name: true } },
      workspace: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } },
      projectMilestones: { orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }], include: { _count: { select: { tasks: true } } } },
      milestones: { select: { id: true, title: true, dueDate: true, completedAt: true, objective: { select: { id: true, title: true } } } },
      risks: { orderBy: [{ status: "asc" }, { createdAt: "desc" }] },
      expenses: { orderBy: { incurredOn: "desc" }, take: 50 },
      sprints: { orderBy: { startDate: "desc" }, take: 20 },
    },
  });
  if (!p) throw notFound("Project");
  const now = today();
  const [byStatus, overdueTasks, milestoneDone, budget] = await Promise.all([
    db().workTask.groupBy({ by: ["status"], where: { projectId, archivedAt: null }, _count: { _all: true } }),
    db().workTask.count({ where: { projectId, archivedAt: null, status: OPEN_TASK, dueDate: { lt: now } } }),
    db().workTask.groupBy({ by: ["milestoneId", "status"], where: { projectId, archivedAt: null, milestoneId: { not: null } }, _count: { _all: true } }),
    budgetSummary(projectId, p.budgetMinor),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const total = byStatus.filter((b) => b.status !== "CANCELLED").reduce((n, b) => n + b._count._all, 0);
  const openTasks = total - count("DONE");
  const names = await userNames(db(), p.risks.map((r) => r.ownerId));
  const highRisks = p.risks.filter((r) => (r.status === "OPEN" || r.status === "MITIGATING") && r.probability * r.impact >= 15).length;
  return {
    ...p,
    risks: p.risks.map((r) => ({ ...r, exposure: r.probability * r.impact, ownerName: r.ownerId ? (names.get(r.ownerId) ?? null) : null })),
    projectMilestones: p.projectMilestones.map((m) => {
      const rows = milestoneDone.filter((x) => x.milestoneId === m.id);
      const all = rows.reduce((n, r) => n + r._count._all, 0);
      const done = rows.find((r) => r.status === "DONE")?._count._all ?? 0;
      return { ...m, tasksTotal: all, tasksDone: done };
    }),
    stats: { total, done: count("DONE"), inProgress: count("IN_PROGRESS") + count("IN_REVIEW"), openTasks, overdueTasks, progress: total ? Math.round((count("DONE") / total) * 100) : 0 },
    budget,
    suggestedHealth: suggestHealth({ dueDate: p.dueDate, status: p.status, openTasks, overdueTasks, highRisks, usedPercent: budget.usedPercent }),
  };
}

export async function updateWorkProject(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof updateProjectInput>) {
  const input = updateProjectInput.parse(raw);
  return transaction(async (tx) => {
    const { chain } = await authorizeProject(ctx, organizationId, companyId, projectId, "projects.manage", tx);
    const before = await tx.project.findFirstOrThrow({ where: { id: projectId } });
    const data: Prisma.ProjectUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description || null;
    if (input.status !== undefined) data.status = input.status;
    if (input.health !== undefined) data.health = input.health;
    if (input.ownerId !== undefined) {
      const ownerId = blank(input.ownerId);
      if (ownerId) await requireEligible(tx, organizationId, chain, ownerId);
      data.ownerId = ownerId;
      if (ownerId) await tx.projectMember.upsert({ where: { projectId_userId: { projectId, userId: ownerId } }, create: { organizationId, companyId, projectId, userId: ownerId, role: "Owner" }, update: {} });
    }
    if (input.startDate !== undefined) data.startDate = toDay(blank(input.startDate));
    if (input.dueDate !== undefined) data.dueDate = toDay(blank(input.dueDate));
    if (input.budget !== undefined) data.budgetMinor = toMinor(blank(input.budget));
    if (input.currency !== undefined && input.currency !== before.currency) {
      const used = (await tx.projectExpense.count({ where: { projectId } })) + (await tx.workTimeEntry.count({ where: { projectId, rateMinor: { not: null } } }));
      if (used) throw conflict("The currency can't change once costs are logged", { reason: "work_currency_locked" });
      data.currency = input.currency;
    }
    if (input.archived !== undefined) data.archivedAt = input.archived ? (before.archivedAt ?? new Date()) : null;
    const start = (data.startDate as Date | null | undefined) ?? before.startDate;
    const due = (data.dueDate as Date | null | undefined) ?? before.dueDate;
    if (start && due && due < start) throw invalid("The due date is before the start date", { reason: "work_dates_order" });
    const p = await tx.project.update({ where: { id: projectId }, data });
    await audit(tx, ctx, organizationId, input.archived === true ? "project.archived" : input.archived === false ? "project.restored" : "project.updated", "project", projectId, input, {
      status: before.status,
      ownerId: before.ownerId,
    });
    return p;
  });
}

export async function addProjectMember(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof memberInput>) {
  const input = memberInput.parse(raw);
  return transaction(async (tx) => {
    const { chain, project } = await authorizeProject(ctx, organizationId, companyId, projectId, "projects.manage", tx);
    await requireEligible(tx, organizationId, chain, input.userId);
    const m = await tx.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: input.userId } },
      create: { organizationId, companyId, projectId, userId: input.userId, role: input.role || null, hourlyRateMinor: toMinor(blank(input.hourlyRate)) },
      update: { role: input.role || null, hourlyRateMinor: toMinor(blank(input.hourlyRate)) },
    });
    await audit(tx, ctx, organizationId, "project.member_set", "project", projectId, { userId: input.userId, role: m.role });
    if (input.userId !== ctx.actor.id) await notifyUsers(tx, organizationId, [input.userId], "work.projectMember", { companyId, title: project.name, href: `/projects/${projectId}` });
    return m;
  });
}

export async function removeProjectMember(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, userId: string) {
  return transaction(async (tx) => {
    await authorizeProject(ctx, organizationId, companyId, projectId, "projects.manage", tx);
    if (!isUuid(userId)) throw notFound("Member");
    const { count } = await tx.projectMember.deleteMany({ where: { projectId, userId } });
    if (!count) throw notFound("Member");
    await audit(tx, ctx, organizationId, "project.member_removed", "project", projectId, { userId });
    return { ok: true };
  });
}

// ─── Milestones ───

export async function createProjectMilestone(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof milestoneInput>) {
  const input = milestoneInput.parse(raw);
  return transaction(async (tx) => {
    await authorizeProject(ctx, organizationId, companyId, projectId, "projects.manage", tx);
    const m = await tx.projectMilestone.create({
      data: { organizationId, companyId, projectId, title: input.title, description: blank(input.description) ?? null, dueDate: toDay(blank(input.dueDate)), completedAt: input.done ? new Date() : null },
    });
    await audit(tx, ctx, organizationId, "project_milestone.created", "project_milestone", m.id, m);
    return m;
  });
}

async function milestoneOf(tx: Tx, organizationId: string, companyId: string, milestoneId: string) {
  if (!isUuid(milestoneId)) throw notFound("Milestone");
  const m = await tx.projectMilestone.findFirst({ where: { id: milestoneId, organizationId, companyId } });
  if (!m) throw notFound("Milestone");
  return m;
}

export async function updateProjectMilestone(ctx: RequestContext, organizationId: string, companyId: string, milestoneId: string, raw: z.input<typeof updateMilestoneInput>) {
  const input = updateMilestoneInput.parse(raw);
  return transaction(async (tx) => {
    const before = await milestoneOf(tx, organizationId, companyId, milestoneId);
    await authorizeProject(ctx, organizationId, companyId, before.projectId, "projects.manage", tx);
    const m = await tx.projectMilestone.update({
      where: { id: milestoneId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: blank(input.description) ?? null } : {}),
        ...(input.dueDate !== undefined ? { dueDate: toDay(blank(input.dueDate)) } : {}),
        ...(input.done !== undefined ? { completedAt: input.done ? (before.completedAt ?? new Date()) : null } : {}),
      },
    });
    await audit(tx, ctx, organizationId, "project_milestone.updated", "project_milestone", m.id, input);
    return m;
  });
}

export async function deleteProjectMilestone(ctx: RequestContext, organizationId: string, companyId: string, milestoneId: string) {
  return transaction(async (tx) => {
    const m = await milestoneOf(tx, organizationId, companyId, milestoneId);
    await authorizeProject(ctx, organizationId, companyId, m.projectId, "projects.manage", tx);
    await tx.workTask.updateMany({ where: { milestoneId, companyId }, data: { milestoneId: null } });
    await tx.workProjectDeliverable.updateMany({ where: { milestoneId, companyId }, data: { milestoneId: null } });
    await tx.projectMilestone.delete({ where: { id: milestoneId } });
    await audit(tx, ctx, organizationId, "project_milestone.deleted", "project_milestone", milestoneId, undefined, { title: m.title });
    return { ok: true };
  });
}

// ─── Risks ───

export async function createRisk(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof riskInput>) {
  const input = riskInput.parse(raw);
  return transaction(async (tx) => {
    const { chain, project } = await authorizeProject(ctx, organizationId, companyId, projectId, "projects.manage", tx);
    const ownerId = blank(input.ownerId) ?? null;
    if (ownerId) await requireEligible(tx, organizationId, chain, ownerId);
    const r = await tx.projectRisk.create({
      data: {
        organizationId,
        companyId,
        projectId,
        title: input.title,
        description: blank(input.description) ?? null,
        probability: input.probability,
        impact: input.impact,
        mitigation: blank(input.mitigation) ?? null,
        ownerId,
        status: input.status,
        createdById: actorId(ctx, organizationId),
      },
    });
    await audit(tx, ctx, organizationId, "project_risk.created", "project_risk", r.id, { title: r.title, probability: r.probability, impact: r.impact });
    if (ownerId && ownerId !== ctx.actor.id) {
        await notifyUsers(tx, organizationId, [ownerId], "work.riskAssigned", { companyId, title: `${r.title} (${project.name})`, href: `/projects/${projectId}` });
    }
    return r;
  });
}

export async function updateRisk(ctx: RequestContext, organizationId: string, companyId: string, riskId: string, raw: z.input<typeof updateRiskInput>) {
  const input = updateRiskInput.parse(raw);
  return transaction(async (tx) => {
    if (!isUuid(riskId)) throw notFound("Risk");
    const before = await tx.projectRisk.findFirst({ where: { id: riskId, organizationId, companyId } });
    if (!before) throw notFound("Risk");
    const { chain } = await authorizeProject(ctx, organizationId, companyId, before.projectId, "projects.manage", tx);
    const ownerId = input.ownerId === undefined ? undefined : (blank(input.ownerId) ?? null);
    if (ownerId) await requireEligible(tx, organizationId, chain, ownerId);
    const r = await tx.projectRisk.update({
      where: { id: riskId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: blank(input.description) ?? null } : {}),
        ...(input.probability !== undefined ? { probability: input.probability } : {}),
        ...(input.impact !== undefined ? { impact: input.impact } : {}),
        ...(input.mitigation !== undefined ? { mitigation: blank(input.mitigation) ?? null } : {}),
        ...(ownerId !== undefined ? { ownerId } : {}),
        ...(input.status !== undefined ? { status: input.status as ProjectRiskStatus } : {}),
      },
    });
    await audit(tx, ctx, organizationId, "project_risk.updated", "project_risk", riskId, input, { status: before.status });
    return r;
  });
}

export async function deleteRisk(ctx: RequestContext, organizationId: string, companyId: string, riskId: string) {
  return transaction(async (tx) => {
    if (!isUuid(riskId)) throw notFound("Risk");
    const r = await tx.projectRisk.findFirst({ where: { id: riskId, organizationId, companyId } });
    if (!r) throw notFound("Risk");
    await authorizeProject(ctx, organizationId, companyId, r.projectId, "projects.manage", tx);
    await tx.projectRisk.delete({ where: { id: riskId } });
    await audit(tx, ctx, organizationId, "project_risk.deleted", "project_risk", riskId, undefined, { title: r.title });
    return { ok: true };
  });
}

// ─── Expenses ───

export async function createExpense(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof expenseInput>) {
  const input = expenseInput.parse(raw);
  return transaction(async (tx) => {
    const { project } = await authorizeProject(ctx, organizationId, companyId, projectId, "projects.manage", tx);
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId }, select: { baseCurrency: true } });
    const e = await tx.projectExpense.create({
      data: { organizationId, companyId, projectId, description: input.description, amountMinor: toMinor(input.amount)!, currency: project.currency ?? company.baseCurrency, incurredOn: toDay(input.incurredOn)!, createdById: actorId(ctx, organizationId) },
    });
    await audit(tx, ctx, organizationId, "project_expense.created", "project_expense", e.id, { amountMinor: e.amountMinor, currency: e.currency });
    return e;
  });
}

export async function deleteExpense(ctx: RequestContext, organizationId: string, companyId: string, expenseId: string) {
  return transaction(async (tx) => {
    if (!isUuid(expenseId)) throw notFound("Expense");
    const e = await tx.projectExpense.findFirst({ where: { id: expenseId, organizationId, companyId } });
    if (!e) throw notFound("Expense");
    await authorizeProject(ctx, organizationId, companyId, e.projectId, "projects.manage", tx);
    await tx.projectExpense.delete({ where: { id: expenseId } });
    await audit(tx, ctx, organizationId, "project_expense.deleted", "project_expense", expenseId, undefined, { amountMinor: e.amountMinor });
    return { ok: true };
  });
}

// ─── Templates ───

export async function listTemplates(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const custom = await db().projectTemplate.findMany({ take: 500, where: { organizationId, companyId }, orderBy: { name: "asc" } });
  return {
    builtIn: BUILT_IN_TEMPLATES.map((b) => ({ key: b.key, milestones: b.blueprint.milestones.length, tasks: b.blueprint.tasks.length })),
    custom: custom.map((c) => {
      const bp = blueprintSchema.safeParse(c.blueprint);
      return { id: c.id, name: c.name, description: c.description, createdAt: c.createdAt, milestones: bp.success ? bp.data.milestones.length : 0, tasks: bp.success ? bp.data.tasks.length : 0 };
    }),
  };
}

/** Save the project's milestones and top-level tasks (with relative dates and dependencies) as a reusable template. */
export async function saveProjectAsTemplate(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof saveTemplateInput>) {
  const input = saveTemplateInput.parse(raw);
  return transaction(async (tx) => {
    await authorizeProject(ctx, organizationId, companyId, projectId, "projects.manage", tx);
    if (BUILT_IN_KEYS.includes(input.name)) throw conflict("Name taken", { reason: "work_template_exists" });
    if (await tx.projectTemplate.findFirst({ where: { companyId, name: input.name }, select: { id: true } })) throw conflict("A template with this name exists", { reason: "work_template_exists" });
    const project = await tx.project.findFirstOrThrow({ where: { id: projectId } });
    const [milestones, tasks] = await Promise.all([
      tx.projectMilestone.findMany({ where: { projectId }, orderBy: { dueDate: "asc" } }),
      tx.workTask.findMany({ where: { projectId, archivedAt: null, parentId: null, status: { not: "CANCELLED" } }, orderBy: [{ startDate: "asc" }, { position: "asc" }], take: 300, include: { dependsOn: { select: { dependsOnId: true } } } }),
    ]);
    const dates = [project.startDate, ...milestones.map((m) => m.dueDate), ...tasks.map((t) => t.startDate ?? t.dueDate)].filter((d): d is Date => !!d);
    const origin = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : today();
    const offset = (d: Date | null) => (d ? Math.max(0, Math.round((d.getTime() - origin.getTime()) / 86_400_000)) : 0);
    const msTitle = new Map(milestones.map((m) => [m.id, m.title]));
    const index = new Map(tasks.map((t, i) => [t.id, i]));
    const blueprint: Blueprint = {
      milestones: milestones.map((m) => ({ title: m.title, offsetDays: offset(m.dueDate) })),
      tasks: tasks.map((t) => {
        const startOff = offset(t.startDate ?? t.dueDate);
        const dur = t.startDate && t.dueDate ? Math.max(1, Math.round((t.dueDate.getTime() - t.startDate.getTime()) / 86_400_000) + 1) : 1;
        const dep = t.dependsOn.map((d) => index.get(d.dependsOnId)).find((i) => i !== undefined);
        return {
          title: t.title,
          ...(t.description ? { description: t.description.slice(0, 5000) } : {}),
          priority: t.priority,
          offsetDays: startOff,
          durationDays: dur,
          ...(t.estimatePoints != null ? { points: t.estimatePoints } : {}),
          labels: t.labels.slice(0, 10),
          ...(t.milestoneId && msTitle.has(t.milestoneId) ? { milestone: msTitle.get(t.milestoneId)! } : {}),
          ...(dep !== undefined ? { after: dep } : {}),
        };
      }),
    };
    const row = await tx.projectTemplate.create({
      data: { organizationId, companyId, name: input.name, description: input.description || null, blueprint: blueprintSchema.parse(blueprint) as unknown as Prisma.InputJsonValue, createdById: actorId(ctx, organizationId) },
    });
    await audit(tx, ctx, organizationId, "project_template.created", "project_template", row.id, { name: row.name, fromProject: projectId });
    return row;
  });
}

export async function deleteTemplate(ctx: RequestContext, organizationId: string, companyId: string, templateId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    if (!isUuid(templateId)) throw notFound("Template");
    const { count } = await tx.projectTemplate.deleteMany({ where: { id: templateId, organizationId, companyId } });
    if (!count) throw notFound("Template");
    await audit(tx, ctx, organizationId, "project_template.deleted", "project_template", templateId);
    return { ok: true };
  });
}

// ─── AI ───

const AI_PROMPTS: Record<(typeof PROJECT_AI_ACTIONS)[number], { profile: string; title: string; instructions: string }> = {
  status_report: {
    profile: "ai_project_manager",
    title: "Status report",
    instructions:
      "Write a concise status report for this project: overall status and health, progress (tasks done vs open), milestones (done, upcoming, at risk), overdue work and who owns it, open risks, budget use, and the 3–5 most important next steps. Read the project with read_project first. Use only the data returned; do not invent facts.",
  },
  detect_risks: {
    profile: "delivery_analyst",
    title: "Risk detection",
    instructions:
      "Analyse this project for delivery risks: overdue or blocked tasks, overloaded assignees (use read_team_workload), milestones likely to slip, unowned work, scope or budget pressure. For each significant risk not already in the register, propose it with create_risk (probability and impact 1–5, mitigation, owner when obvious). Finish with a short summary of what you found.",
  },
  plan: {
    profile: "ai_project_manager",
    title: "Project plan",
    instructions:
      "Plan this project. Read it with read_project, consider its description, milestones and existing tasks, then propose the missing tasks with create_work_task (clear titles, priorities, start/due dates, estimates) and assignments with assign_task based on team workload (read_team_workload). Avoid duplicating existing tasks. Finish with a summary of the plan and open questions.",
  },
};

/** Start an AI task about this project (status report, risk detection or planning). */
export async function startProjectAi(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof projectAiInput>) {
  const { action } = projectAiInput.parse(raw);
  const { project } = await authorizeProject(ctx, organizationId, companyId, projectId, "projects.read");
  const p = AI_PROMPTS[action];
  return createAgentTask(ctx, organizationId, companyId, {
    profile: p.profile,
    title: `${p.title}: ${project.name}`.slice(0, 200),
    instructions: `${p.instructions}\n\nProject id: ${projectId}\nProject name: ${project.name}\nToday: ${dayString(today())}`,
    subject: { type: "project", id: projectId },
  });
}

/** Light project header data for the project sub-pages (also lists milestones/sprints/members for pickers). */
export async function projectSummary(ctx: RequestContext, organizationId: string, companyId: string, projectId: string) {
  await authorizeProject(ctx, organizationId, companyId, projectId, "projects.read");
  const p = await db().project.findFirst({
    where: { id: projectId, organizationId, companyId },
    select: {
      id: true,
      name: true,
      status: true,
      health: true,
      archivedAt: true,
      startDate: true,
      dueDate: true,
      currency: true,
      projectMilestones: { orderBy: { dueDate: { sort: "asc", nulls: "last" } }, select: { id: true, title: true, dueDate: true, completedAt: true } },
      sprints: { where: { status: { not: "COMPLETED" } }, orderBy: { startDate: "asc" }, select: { id: true, name: true, status: true } },
    },
  });
  if (!p) throw notFound("Project");
  return p;
}
