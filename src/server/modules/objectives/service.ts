import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const uuid = z.string().uuid();
const isUuid = (v: string) => uuid.safeParse(v).success;

export const createObjectiveInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  targetDate: date.optional(),
});
export const objectiveStatusInput = z.object({ status: z.enum(["ACTIVE", "ACHIEVED", "ABANDONED"]) });
export const createMilestoneInput = z.object({
  objectiveId: uuid,
  title: z.string().trim().min(1).max(200),
  dueDate: date.optional(),
  projectId: uuid.optional(),
});
export const milestoneDoneInput = z.object({ done: z.boolean() });

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "objectives.read" | "objectives.manage", tx?: Tx) {
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), organizationId, companyId), tx);
}

/** Objectives of a company with their milestones (and each milestone's project and AI task counts). */
export async function listObjectives(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "objectives.read");
  return db().objective.findMany({
    where: { organizationId, companyId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      milestones: {
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        include: { project: { select: { id: true, name: true } }, _count: { select: { tasks: true } } },
      },
    },
  });
}

export async function createObjective(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createObjectiveInput>) {
  const input = createObjectiveInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    const o = await tx.objective.create({
      data: { organizationId, companyId, title: input.title, description: input.description || null, targetDate: input.targetDate ? new Date(input.targetDate) : null, createdById: ctx.actor.id ?? organizationId },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "objective.created", resourceType: "objective", resourceId: o.id, newValue: o });
    await emitEvent(tx, ctx, "objective.created", { objectiveId: o.id, companyId }, { organizationId, companyId, aggregateType: "objective", aggregateId: o.id });
    return o;
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
