import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { grantsAllow, loadGrants, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";
import { keyResultInput, validateKeyResult, type KeyResultData } from "./key-results";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const uuid = z.string().uuid();
const optUuid = uuid.or(z.literal("")).nullable().optional();
const optDate = date.or(z.literal("")).nullable().optional();
export const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.safeParse(v).success;
export const toDay = (v?: string | null) => (v ? new Date(`${v}T00:00:00Z`) : null);
const blank = <T>(v: T | "" | null | undefined): T | null => (v === "" || v === undefined || v === null ? null : v);

export const OBJECTIVE_STATUSES = ["ACTIVE", "ACHIEVED", "ABANDONED"] as const;

export const createObjectiveInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  targetDate: optDate,
  startDate: optDate,
  goalId: optUuid,
  ownerId: optUuid,
  departmentId: optUuid,
  /** Key results created with the objective (same transaction). */
  keyResults: z.array(keyResultInput).max(10).default([]),
});
export const updateObjectiveInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  targetDate: optDate,
  startDate: optDate,
  goalId: optUuid,
  ownerId: optUuid,
  departmentId: optUuid,
});
export const objectiveStatusInput = z.object({ status: z.enum(OBJECTIVE_STATUSES) });
export const createMilestoneInput = z.object({
  objectiveId: uuid,
  title: z.string().trim().min(1).max(200),
  dueDate: date.optional(),
  projectId: uuid.optional(),
});
export const milestoneDoneInput = z.object({ done: z.boolean() });

export interface ObjectiveFilters {
  q?: string;
  status?: (typeof OBJECTIVE_STATUSES)[number];
  goalId?: string;
  departmentId?: string;
  sort?: "created" | "target" | "title";
}

export async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "objectives.read" | "objectives.manage", tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

/** Active members (active users) who hold `permission` at the chain — owner pickers and owner checks. */
export async function eligibleMembers(client: Tx | Db, organizationId: string, chain: ScopeChain, permission: string, candidates?: string[]) {
  const members = await client.membership.findMany({
    where: { organizationId, status: "ACTIVE", ...(candidates ? { userId: { in: candidates } } : {}), user: { status: "ACTIVE" } },
    select: { userId: true },
  });
  const ok: string[] = [];
  for (const m of members) if (grantsAllow(await loadGrants(client, "USER", m.userId), permission, chain)) ok.push(m.userId);
  return ok;
}

/** Owner, department and goal references of an objective must belong to this company. */
async function checkRefs(tx: Tx, organizationId: string, companyId: string, chain: ScopeChain, refs: { ownerId?: string | null; departmentId?: string | null; goalId?: string | null }) {
  if (refs.ownerId && !(await eligibleMembers(tx, organizationId, chain, "objectives.read", [refs.ownerId])).length) {
    throw invalid("This person has no access to objectives", { reason: "objectives_owner_ineligible" });
  }
  if (refs.departmentId && !(await tx.department.findFirst({ where: { id: refs.departmentId, organizationId, companyId, archivedAt: null }, select: { id: true } }))) throw notFound("Department");
  if (refs.goalId && !(await tx.companyGoal.findFirst({ where: { id: refs.goalId, organizationId, companyId }, select: { id: true } }))) throw notFound("Goal");
}

const objectiveInclude = {
  milestones: {
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    include: { project: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
  },
  keyResults: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
  goal: { select: { id: true, title: true } },
  owner: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
} satisfies Prisma.ObjectiveInclude;

/** Objectives of a company with milestones (and each milestone's project and AI task counts) and key results. */
export async function listObjectives(ctx: RequestContext, organizationId: string, companyId: string, f: ObjectiveFilters = {}) {
  await authorize(ctx, organizationId, companyId, "objectives.read");
  const where: Prisma.ObjectiveWhereInput = { organizationId, companyId };
  if (f.status) where.status = f.status;
  if (f.goalId) where.goalId = f.goalId === "none" ? null : f.goalId;
  if (f.departmentId) where.departmentId = f.departmentId;
  if (f.q) where.OR = [{ title: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }];
  const orderBy: Prisma.ObjectiveOrderByWithRelationInput[] =
    f.sort === "target" ? [{ targetDate: { sort: "asc", nulls: "last" } }] : f.sort === "title" ? [{ title: "asc" }] : [{ status: "asc" }, { createdAt: "desc" }];
  return db().objective.findMany({ where, orderBy, take: 200, include: objectiveInclude });
}
export type ObjectiveWithDetails = Awaited<ReturnType<typeof listObjectives>>[number];

export async function createObjective(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createObjectiveInput>) {
  const input = createObjectiveInput.parse(raw);
  const startDate = toDay(blank(input.startDate));
  const targetDate = toDay(blank(input.targetDate));
  if (startDate && targetDate && targetDate < startDate) throw invalid("The target date is before the start date", { reason: "objectives_dates_order" });
  const keyResults: KeyResultData[] = [];
  for (const kr of input.keyResults) keyResults.push(await validateKeyResult(ctx, organizationId, companyId, kr));
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    const refs = { ownerId: blank(input.ownerId), departmentId: blank(input.departmentId), goalId: blank(input.goalId) };
    await checkRefs(tx, organizationId, companyId, chain, refs);
    const o = await tx.objective.create({
      data: { organizationId, companyId, title: input.title, description: input.description || null, targetDate, startDate, ...refs, createdById: ctx.actor.id ?? organizationId },
    });
    if (keyResults.length) await tx.objectiveKeyResult.createMany({ data: keyResults.map((kr, i) => ({ ...kr, organizationId, companyId, objectiveId: o.id, position: i })) });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "objective.created", resourceType: "objective", resourceId: o.id, newValue: { ...o, keyResults: keyResults.length } });
    await emitEvent(tx, ctx, "objective.created", { objectiveId: o.id, companyId }, { organizationId, companyId, aggregateType: "objective", aggregateId: o.id });
    return o;
  });
}

export async function updateObjective(ctx: RequestContext, organizationId: string, companyId: string, objectiveId: string, raw: z.input<typeof updateObjectiveInput>) {
  const input = updateObjectiveInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    if (!isUuid(objectiveId)) throw notFound("Objective");
    const before = await tx.objective.findFirst({ where: { id: objectiveId, organizationId, companyId } });
    if (!before) throw notFound("Objective");
    const data: Prisma.ObjectiveUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description || null;
    const startDate = input.startDate !== undefined ? toDay(blank(input.startDate)) : before.startDate;
    const targetDate = input.targetDate !== undefined ? toDay(blank(input.targetDate)) : before.targetDate;
    if (startDate && targetDate && targetDate < startDate) throw invalid("The target date is before the start date", { reason: "objectives_dates_order" });
    data.startDate = startDate;
    data.targetDate = targetDate;
    const refs: { ownerId?: string | null; departmentId?: string | null; goalId?: string | null } = {};
    for (const k of ["ownerId", "departmentId", "goalId"] as const) if (input[k] !== undefined) refs[k] = blank(input[k]);
    await checkRefs(tx, organizationId, companyId, chain, refs);
    Object.assign(data, refs);
    const o = await tx.objective.update({ where: { id: objectiveId }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "objective.updated", resourceType: "objective", resourceId: objectiveId, oldValue: before, newValue: o });
    return o;
  });
}

/** Delete an objective with its milestones and key results. Refused while AI tasks reference its milestones. */
export async function deleteObjective(ctx: RequestContext, organizationId: string, companyId: string, objectiveId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    if (!isUuid(objectiveId)) throw notFound("Objective");
    const before = await tx.objective.findFirst({ where: { id: objectiveId, organizationId, companyId }, select: { id: true, title: true } });
    if (!before) throw notFound("Objective");
    if (await tx.agentTask.count({ where: { companyId, milestone: { objectiveId } } })) {
      throw conflict("AI tasks are linked to this objective's milestones; mark it abandoned instead", { reason: "objectives_has_ai_tasks" });
    }
    await tx.objective.delete({ where: { id: objectiveId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "objective.deleted", resourceType: "objective", resourceId: objectiveId, oldValue: before });
    return { ok: true };
  });
}

export async function setObjectiveStatus(ctx: RequestContext, organizationId: string, companyId: string, objectiveId: string, raw: z.input<typeof objectiveStatusInput>) {
  const { status } = objectiveStatusInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    if (!isUuid(objectiveId)) throw notFound("Objective");
    const before = await tx.objective.findFirst({ where: { id: objectiveId, organizationId, companyId } });
    if (!before) throw notFound("Objective");
    const o = await tx.objective.update({ where: { id: objectiveId }, data: { status } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "objective.status_changed", resourceType: "objective", resourceId: objectiveId, oldValue: { status: before.status }, newValue: { status } });
    return o;
  });
}

/** Add a milestone; the objective and the optional project must belong to the same company (FK-enforced too). */
export async function createMilestone(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createMilestoneInput>) {
  const input = createMilestoneInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    const objective = await tx.objective.findFirst({ where: { id: input.objectiveId, organizationId, companyId }, select: { id: true, status: true } });
    if (!objective) throw notFound("Objective");
    if (objective.status !== "ACTIVE") throw conflict("Milestones can only be added to active objectives");
    if (input.projectId && !(await tx.project.findFirst({ where: { id: input.projectId, organizationId, companyId }, select: { id: true } }))) throw notFound("Project");
    const m = await tx.milestone.create({
      data: { organizationId, companyId, objectiveId: objective.id, title: input.title, dueDate: input.dueDate ? new Date(input.dueDate) : null, projectId: input.projectId ?? null },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "milestone.created", resourceType: "milestone", resourceId: m.id, newValue: m });
    return m;
  });
}

export async function setMilestoneDone(ctx: RequestContext, organizationId: string, companyId: string, milestoneId: string, raw: z.input<typeof milestoneDoneInput>) {
  const { done } = milestoneDoneInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    if (!isUuid(milestoneId)) throw notFound("Milestone");
    const before = await tx.milestone.findFirst({ where: { id: milestoneId, organizationId, companyId } });
    if (!before) throw notFound("Milestone");
    const m = await tx.milestone.update({ where: { id: milestoneId }, data: { completedAt: done ? (before.completedAt ?? new Date()) : null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: done ? "milestone.completed" : "milestone.reopened", resourceType: "milestone", resourceId: milestoneId });
    if (done && !before.completedAt) {
      await emitEvent(tx, ctx, "milestone.completed", { milestoneId, objectiveId: before.objectiveId, companyId }, { organizationId, companyId, aggregateType: "milestone", aggregateId: milestoneId });
    }
    return m;
  });
}

/** Delete a milestone (the linked project stays). Refused while AI tasks reference it. */
export async function deleteMilestone(ctx: RequestContext, organizationId: string, companyId: string, milestoneId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    if (!isUuid(milestoneId)) throw notFound("Milestone");
    const before = await tx.milestone.findFirst({ where: { id: milestoneId, organizationId, companyId }, include: { _count: { select: { tasks: true } } } });
    if (!before) throw notFound("Milestone");
    if (before._count.tasks) throw conflict("AI tasks are linked to this milestone", { reason: "objectives_has_ai_tasks" });
    await tx.milestone.delete({ where: { id: milestoneId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "milestone.deleted", resourceType: "milestone", resourceId: milestoneId, oldValue: { title: before.title } });
    return { ok: true };
  });
}
