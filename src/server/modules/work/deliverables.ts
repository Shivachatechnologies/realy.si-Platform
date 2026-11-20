import { z } from "zod";
import type { WorkDeliverableStatus } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { actorId, authorizeProject, blank, isUuid, optDay, optText, optUuid, projectScope, requireEligible, toDay, userNames } from "./shared";

/**
 * Project deliverables: the tangible outputs a project promises. The owner moves a deliverable to SUBMITTED with a link
 * to the result; a project manager accepts or rejects it with a note. Deliverables can hang off a milestone.
 */

export const DELIVERABLE_STATUSES = ["PLANNED", "IN_PROGRESS", "SUBMITTED", "ACCEPTED", "REJECTED"] as const satisfies readonly WorkDeliverableStatus[];
const link = z.string().trim().url().max(500).refine((v) => /^https:\/\//i.test(v), "Use an https link").or(z.literal("")).nullable().optional();

export const deliverableInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: optText(5000),
  milestoneId: optUuid,
  ownerId: optUuid,
  dueDate: optDay,
  url: link,
});
export const updateDeliverableInput = deliverableInput.partial().extend({
  status: z.enum(["PLANNED", "IN_PROGRESS", "SUBMITTED"]).optional(),
});
export const reviewDeliverableInput = z.object({ accept: z.boolean(), note: optText(2000) });

const audit = (tx: Tx, ctx: RequestContext, organizationId: string, action: string, resourceId: string, newValue?: unknown, oldValue?: unknown) =>
  writeAudit(tx, ctx, { category: "TENANT", organizationId, action, resourceType: "project_deliverable", resourceId, newValue, oldValue });

async function checkRefs(tx: Tx, organizationId: string, companyId: string, projectId: string, refs: { milestoneId?: string | null; ownerId?: string | null }) {
  if (refs.milestoneId && !(await tx.projectMilestone.findFirst({ where: { id: refs.milestoneId, organizationId, companyId, projectId }, select: { id: true } }))) throw notFound("Milestone");
  if (refs.ownerId) {
    const { chain } = await projectScope(tx, organizationId, companyId, projectId);
    await requireEligible(tx, organizationId, chain, refs.ownerId, "projects.read");
  }
}

async function deliverableOf(tx: Tx, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Deliverable");
  const d = await tx.workProjectDeliverable.findFirst({ where: { id, organizationId, companyId } });
  if (!d) throw notFound("Deliverable");
  return d;
}

export async function listDeliverables(ctx: RequestContext, organizationId: string, companyId: string, projectId: string) {
  await authorizeProject(ctx, organizationId, companyId, projectId, "projects.read");
  const rows = await db().workProjectDeliverable.findMany({ where: { organizationId, companyId, projectId }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], take: 300 });
  const names = await userNames(db(), rows.flatMap((r) => [r.ownerId, r.reviewedById]));
  return rows.map((r) => ({ ...r, ownerName: r.ownerId ? (names.get(r.ownerId) ?? null) : null, reviewedByName: r.reviewedById ? (names.get(r.reviewedById) ?? null) : null }));
}

export async function createDeliverable(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof deliverableInput>) {
  const input = deliverableInput.parse(raw);
  return transaction(async (tx) => {
    await authorizeProject(ctx, organizationId, companyId, projectId, "projects.manage", tx);
    const milestoneId = blank(input.milestoneId) ?? null;
    const ownerId = blank(input.ownerId) ?? null;
    await checkRefs(tx, organizationId, companyId, projectId, { milestoneId, ownerId });
    if ((await tx.workProjectDeliverable.count({ where: { projectId, companyId } })) >= 300) throw conflict("A project has at most 300 deliverables", { reason: "work_deliverables_full" });
    const d = await tx.workProjectDeliverable.create({
      data: { organizationId, companyId, projectId, milestoneId, ownerId, title: input.title, description: blank(input.description) ?? null, dueDate: toDay(blank(input.dueDate)), url: blank(input.url) ?? null, createdById: actorId(ctx, organizationId) },
    });
    await audit(tx, ctx, organizationId, "project_deliverable.created", d.id, { title: d.title, projectId, milestoneId, ownerId });
    if (ownerId && ownerId !== ctx.actor.id) await notifyUsers(tx, organizationId, [ownerId], "work.deliverableAssigned", { companyId, title: d.title, href: `/projects/${projectId}` });
    return d;
  });
}

export async function updateDeliverable(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateDeliverableInput>) {
  const input = updateDeliverableInput.parse(raw);
  return transaction(async (tx) => {
    const before = await deliverableOf(tx, organizationId, companyId, id);
    await authorizeProject(ctx, organizationId, companyId, before.projectId, "projects.manage", tx);
    const milestoneId = input.milestoneId !== undefined ? (blank(input.milestoneId) ?? null) : undefined;
    const ownerId = input.ownerId !== undefined ? (blank(input.ownerId) ?? null) : undefined;
    await checkRefs(tx, organizationId, companyId, before.projectId, { milestoneId, ownerId });
    const url = input.url !== undefined ? (blank(input.url) ?? null) : before.url;
    if (input.status === "SUBMITTED" && !url) throw conflict("Add a link to the result before submitting", { reason: "work_deliverable_needs_link" });
    const d = await tx.workProjectDeliverable.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: blank(input.description) ?? null } : {}),
        ...(milestoneId !== undefined ? { milestoneId } : {}),
        ...(ownerId !== undefined ? { ownerId } : {}),
        ...(input.dueDate !== undefined ? { dueDate: toDay(blank(input.dueDate)) } : {}),
        ...(input.url !== undefined ? { url } : {}),
        // A change after review re-opens it.
        ...(input.status ? { status: input.status, reviewedAt: null, reviewedById: null, reviewNote: null } : {}),
      },
    });
    await audit(tx, ctx, organizationId, "project_deliverable.updated", id, input, { status: before.status });
    if (input.status === "SUBMITTED" && before.status !== "SUBMITTED") {
      const project = await tx.project.findFirst({ where: { id: before.projectId, companyId }, select: { ownerId: true } });
      if (project?.ownerId && project.ownerId !== ctx.actor.id) await notifyUsers(tx, organizationId, [project.ownerId], "work.deliverableSubmitted", { companyId, title: d.title, href: `/projects/${before.projectId}` });
    }
    return d;
  });
}

/** Accept or reject a submitted deliverable (project managers). */
export async function reviewDeliverable(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof reviewDeliverableInput>) {
  const input = reviewDeliverableInput.parse(raw);
  return transaction(async (tx) => {
    const before = await deliverableOf(tx, organizationId, companyId, id);
    await authorizeProject(ctx, organizationId, companyId, before.projectId, "projects.manage", tx);
    if (before.status !== "SUBMITTED") throw conflict("Only submitted deliverables can be reviewed", { reason: "work_deliverable_not_submitted" });
    const d = await tx.workProjectDeliverable.update({
      where: { id },
      data: { status: input.accept ? "ACCEPTED" : "REJECTED", reviewNote: blank(input.note) ?? null, reviewedAt: new Date(), reviewedById: ctx.actor.id },
    });
    await audit(tx, ctx, organizationId, input.accept ? "project_deliverable.accepted" : "project_deliverable.rejected", id, { note: input.note });
    if (before.ownerId && before.ownerId !== ctx.actor.id) {
      await notifyUsers(tx, organizationId, [before.ownerId], input.accept ? "work.deliverableAccepted" : "work.deliverableRejected", { companyId, title: d.title, href: `/projects/${before.projectId}` });
    }
    return d;
  });
}

export async function deleteDeliverable(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    const d = await deliverableOf(tx, organizationId, companyId, id);
    await authorizeProject(ctx, organizationId, companyId, d.projectId, "projects.manage", tx);
    await tx.workProjectDeliverable.delete({ where: { id } });
    await audit(tx, ctx, organizationId, "project_deliverable.deleted", id, undefined, { title: d.title });
    return { ok: true };
  });
}
