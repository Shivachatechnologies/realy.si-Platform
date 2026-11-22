import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { can } from "@/server/modules/rbac/service";
import { authorize, eligibleMembers, isUuid, toDay } from "./service";
import { budgetColumns, budgetInput, goalBudgets } from "./budgets";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optUuid = z.string().uuid().or(z.literal("")).nullable().optional();
const optDate = date.or(z.literal("")).nullable().optional();
const blank = <T>(v: T | "" | null | undefined): T | null => (v === "" || v === undefined || v === null ? null : v);

export const GOAL_HORIZONS = ["QUARTER", "YEAR"] as const;
export const GOAL_STATUSES = ["ACTIVE", "ACHIEVED", "ABANDONED"] as const;

export const goalInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).nullable().optional(),
  horizon: z.enum(GOAL_HORIZONS).default("QUARTER"),
  ownerId: optUuid,
  pillarId: optUuid,
  targetDate: optDate,
  /** Budget for the goal (B15); actual = AI and provider spend of its work. */
  budget: budgetInput,
});
export const createGoalInput = goalInput.extend({
  /** Start the AI decomposition right away (Command Center objective bar). */
  plan: z.boolean().default(false),
});
export const updateGoalInput = goalInput.partial().extend({ status: z.enum(GOAL_STATUSES).optional() });

export const strategyInput = z.object({
  mission: z.string().trim().max(2000).nullable().optional(),
  vision: z.string().trim().max(2000).nullable().optional(),
  values: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  pillars: z
    .array(z.object({ id: z.string().uuid().optional(), title: z.string().trim().min(1).max(200), description: z.string().trim().max(1000).nullable().optional() }))
    .max(12)
    .default([]),
});

export interface GoalFilters {
  q?: string;
  status?: (typeof GOAL_STATUSES)[number];
  horizon?: (typeof GOAL_HORIZONS)[number];
}

/** Default target date for a horizon: end of the current quarter / year (UTC). */
export function horizonEnd(horizon: (typeof GOAL_HORIZONS)[number], now = new Date()) {
  const y = now.getUTCFullYear();
  return horizon === "YEAR" ? new Date(Date.UTC(y, 11, 31)) : new Date(Date.UTC(y, Math.floor(now.getUTCMonth() / 3) * 3 + 3, 0));
}

async function checkGoalRefs(tx: Prisma.TransactionClient, organizationId: string, companyId: string, chain: Awaited<ReturnType<typeof authorize>>, refs: { ownerId?: string | null; pillarId?: string | null }) {
  if (refs.ownerId && !(await eligibleMembers(tx, organizationId, chain, "objectives.read", [refs.ownerId])).length) {
    throw invalid("This person has no access to objectives", { reason: "objectives_owner_ineligible" });
  }
  if (refs.pillarId && !(await tx.strategyPillar.findFirst({ where: { id: refs.pillarId, organizationId, companyId }, select: { id: true } }))) throw notFound("Pillar");
}

export async function listGoals(ctx: RequestContext, organizationId: string, companyId: string, f: GoalFilters = {}) {
  await authorize(ctx, organizationId, companyId, "objectives.read");
  const where: Prisma.CompanyGoalWhereInput = { organizationId, companyId };
  if (f.status) where.status = f.status;
  if (f.horizon) where.horizon = f.horizon;
  if (f.q) where.OR = [{ title: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }];
  return db().companyGoal.findMany({
    where,
    orderBy: [{ status: "asc" }, { targetDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
    include: { owner: { select: { id: true, name: true } }, pillar: { select: { id: true, title: true } }, _count: { select: { objectives: true } } },
  });
}

/** Goals with budget vs actual (B15): the AI and provider spend of every task that worked on each goal. */
export async function listGoalsWithBudgets(ctx: RequestContext, organizationId: string, companyId: string, f: GoalFilters = {}) {
  const goals = await listGoals(ctx, organizationId, companyId, f);
  const budgets = await goalBudgets({ organizationId, companyId }, goals);
  return goals.map((g) => ({ ...g, budgetStatus: budgets.get(g.id)! }));
}

export async function getGoal(ctx: RequestContext, organizationId: string, companyId: string, goalId: string) {
  await authorize(ctx, organizationId, companyId, "objectives.read");
  if (!isUuid(goalId)) throw notFound("Goal");
  const g = await db().companyGoal.findFirst({ where: { id: goalId, organizationId, companyId }, include: { owner: { select: { id: true, name: true } }, pillar: { select: { id: true, title: true } } } });
  if (!g) throw notFound("Goal");
  return g;
}

export async function createGoal(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof goalInput>) {
  const input = goalInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    const refs = { ownerId: blank(input.ownerId) ?? ctx.actor.id ?? null, pillarId: blank(input.pillarId) };
    await checkGoalRefs(tx, organizationId, companyId, chain, refs);
    const g = await tx.companyGoal.create({
      data: {
        organizationId,
        companyId,
        title: input.title,
        description: input.description || null,
        horizon: input.horizon,
        targetDate: toDay(blank(input.targetDate)) ?? horizonEnd(input.horizon),
        ...budgetColumns(input.budget),
        ...refs,
        createdById: ctx.actor.id ?? organizationId,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "company_goal.created", resourceType: "company_goal", resourceId: g.id, newValue: g });
    return g;
  });
}

export async function updateGoal(ctx: RequestContext, organizationId: string, companyId: string, goalId: string, raw: z.input<typeof updateGoalInput>) {
  const input = updateGoalInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    if (!isUuid(goalId)) throw notFound("Goal");
    const before = await tx.companyGoal.findFirst({ where: { id: goalId, organizationId, companyId } });
    if (!before) throw notFound("Goal");
    const refs: { ownerId?: string | null; pillarId?: string | null } = {};
    if (input.ownerId !== undefined) refs.ownerId = blank(input.ownerId);
    if (input.pillarId !== undefined) refs.pillarId = blank(input.pillarId);
    await checkGoalRefs(tx, organizationId, companyId, chain, refs);
    const g = await tx.companyGoal.update({
      where: { id: goalId },
      data: {
        ...refs,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.horizon !== undefined ? { horizon: input.horizon } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.targetDate !== undefined ? { targetDate: toDay(blank(input.targetDate)) } : {}),
        ...budgetColumns(input.budget),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "company_goal.updated", resourceType: "company_goal", resourceId: goalId, oldValue: before, newValue: g });
    return g;
  });
}

/** Delete a goal; its objectives stay (unlinked). */
export async function deleteGoal(ctx: RequestContext, organizationId: string, companyId: string, goalId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    if (!isUuid(goalId)) throw notFound("Goal");
    const before = await tx.companyGoal.findFirst({ where: { id: goalId, organizationId, companyId }, select: { id: true, title: true } });
    if (!before) throw notFound("Goal");
    await tx.objective.updateMany({ where: { goalId, companyId }, data: { goalId: null } });
    await tx.companyGoal.delete({ where: { id: goalId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "company_goal.deleted", resourceType: "company_goal", resourceId: goalId, oldValue: before });
    return { ok: true };
  });
}

// ───────────── Mission, vision, values, pillars ─────────────

export async function getStrategy(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "objectives.read");
  const [strategy, pillars] = await Promise.all([
    db().companyStrategy.findFirst({ where: { organizationId, companyId } }),
    db().strategyPillar.findMany({ where: { organizationId, companyId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { _count: { select: { goals: true } } } }),
  ]);
  return { mission: strategy?.mission ?? null, vision: strategy?.vision ?? null, values: strategy?.values ?? [], updatedAt: strategy?.updatedAt ?? null, pillars };
}

/** Replace mission, vision, values and the pillar list (pillars not listed are removed; their goals are unlinked). */
export async function saveStrategy(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof strategyInput>) {
  const input = strategyInput.parse(raw);
  await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    const data = { mission: input.mission || null, vision: input.vision || null, values: [...new Set(input.values)], updatedById: ctx.actor.id ?? null };
    await tx.companyStrategy.upsert({ where: { companyId }, create: { organizationId, companyId, ...data }, update: data });
    const existing = await tx.strategyPillar.findMany({ where: { organizationId, companyId }, select: { id: true } });
    const keep = new Set(input.pillars.flatMap((p) => (p.id ? [p.id] : [])));
    const removed = existing.filter((p) => !keep.has(p.id)).map((p) => p.id);
    if (removed.length) {
      await tx.companyGoal.updateMany({ where: { companyId, pillarId: { in: removed } }, data: { pillarId: null } });
      await tx.strategyPillar.deleteMany({ where: { companyId, id: { in: removed } } });
    }
    const known = new Set(existing.map((p) => p.id));
    for (const [position, p] of input.pillars.entries()) {
      const row = { title: p.title, description: p.description || null, position };
      if (p.id && known.has(p.id)) await tx.strategyPillar.update({ where: { id: p.id }, data: row });
      else await tx.strategyPillar.create({ data: { organizationId, companyId, ...row } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "company_strategy.updated", resourceType: "company_strategy", resourceId: companyId, newValue: { ...data, pillars: input.pillars.map((p) => p.title) } });
  });
  return getStrategy(ctx, organizationId, companyId);
}

// ───────────── Goals tree ─────────────

/**
 * Goals → objectives (with key results) → milestones → linked projects with task counts. Project details are included
 * only for viewers with projects.read.
 */
export async function goalTree(ctx: RequestContext, organizationId: string, companyId: string, opts: { goalId?: string; status?: (typeof GOAL_STATUSES)[number] } = {}) {
  const chain = await authorize(ctx, organizationId, companyId, "objectives.read");
  const canProjects = await can(ctx, "projects.read", chain);
  const goals = await db().companyGoal.findMany({
    where: { organizationId, companyId, ...(opts.goalId ? { id: opts.goalId } : {}), ...(opts.status ? { status: opts.status } : {}) },
    orderBy: [{ status: "asc" }, { targetDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 50,
    include: {
      owner: { select: { id: true, name: true } },
      pillar: { select: { id: true, title: true } },
      objectives: {
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        include: {
          keyResults: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
          owner: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          milestones: { orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], include: { project: { select: { id: true, name: true, status: true, dueDate: true } } } },
        },
      },
    },
  });
  const projectIds = [...new Set(goals.flatMap((g) => g.objectives.flatMap((o) => o.milestones.flatMap((m) => (m.projectId ? [m.projectId] : [])))))];
  const counts = new Map<string, { total: number; done: number }>();
  if (canProjects && projectIds.length) {
    const rows = await db().workTask.groupBy({ by: ["projectId", "status"], where: { companyId, projectId: { in: projectIds }, archivedAt: null, status: { not: "CANCELLED" } }, _count: true });
    for (const r of rows) {
      if (!r.projectId) continue;
      const c = counts.get(r.projectId) ?? { total: 0, done: 0 };
      c.total += r._count;
      if (r.status === "DONE") c.done += r._count;
      counts.set(r.projectId, c);
    }
  }
  return { goals, taskCounts: counts, canProjects, chain };
}
