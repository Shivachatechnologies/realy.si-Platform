import { z } from "zod";
import type { WorkTaskStatus } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { archiveWorkTask, createWorkTask, updateWorkTask } from "@/server/modules/work/tasks";
import { authorize, day, isUuid, uuid, ZERO_UUID } from "./common";

/**
 * Sales tasks: WorkTasks (work module) linked to a deal, lead or account via sourceType/sourceId. They are created and
 * changed through the work module's services (createWorkTask / updateWorkTask — which also enforce projects.manage and
 * emit task.created / task.completed), after the CRM check (sales.manage) and the record lookup.
 */

export const SALES_TASK_SOURCES = { deal: "crm_deal", lead: "crm_lead", account: "crm_account" } as const;
export type SalesTaskSubject = keyof typeof SALES_TASK_SOURCES;
const SOURCE_TYPES = Object.values(SALES_TASK_SOURCES);
const OPEN: WorkTaskStatus[] = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW"];

export const salesTaskInput = z.object({
  subjectType: z.enum(["deal", "lead", "account"]),
  subjectId: uuid,
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).optional(),
  assigneeId: uuid.optional().or(z.literal("").transform(() => undefined)),
  dueDate: day.optional().or(z.literal("").transform(() => undefined)),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
});
export const salesTaskPatch = z.object({
  done: z.boolean().optional(),
  assigneeId: uuid.nullable().optional(),
  dueDate: day.nullable().optional().or(z.literal("").transform(() => null)),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  title: z.string().trim().min(1).max(300).optional(),
});

const select = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  sourceType: true,
  sourceId: true,
  createdAt: true,
  assignee: { select: { id: true, name: true } },
} as const;

async function subjectName(organizationId: string, companyId: string, type: SalesTaskSubject, id: string) {
  const where = { id, organizationId, companyId };
  const row =
    type === "deal"
      ? await db().crmDeal.findFirst({ where, select: { name: true } })
      : type === "lead"
        ? await db().lead.findFirst({ where, select: { name: true } })
        : await db().account.findFirst({ where, select: { name: true } });
  if (!row) throw notFound(type === "deal" ? "Deal" : type === "lead" ? "Lead" : "Account");
  return row.name;
}

export const subjectHref = (sourceType: string | null, sourceId: string | null) =>
  !sourceId ? null : sourceType === "crm_deal" ? `/crm/deals/${sourceId}` : sourceType === "crm_lead" ? `/crm/${sourceId}` : sourceType === "crm_account" ? `/crm/accounts/${sourceId}` : null;

/** Open and recently completed tasks of a record (newest due first; done last). */
export async function listSalesTasks(ctx: RequestContext, organizationId: string, companyId: string, subjectType: SalesTaskSubject, subjectId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  if (!isUuid(subjectId)) throw notFound("Record");
  const rows = await db().workTask.findMany({
    where: { organizationId, companyId, archivedAt: null, sourceType: SALES_TASK_SOURCES[subjectType], sourceId: subjectId },
    orderBy: [{ completedAt: { sort: "desc", nulls: "first" } }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 100,
    select,
  });
  return rows;
}

export async function createSalesTask(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof salesTaskInput>) {
  const input = salesTaskInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "sales.manage");
  const name = await subjectName(organizationId, companyId, input.subjectType, input.subjectId);
  const task = await createWorkTask(ctx, organizationId, companyId, {
    title: input.title,
    description: input.description || `${input.subjectType === "deal" ? "Deal" : input.subjectType === "lead" ? "Lead" : "Account"}: ${name}`,
    assigneeId: input.assigneeId,
    dueDate: input.dueDate,
    priority: input.priority,
    labels: ["sales"],
  });
  // Link it to the CRM record (createWorkTask has no source fields).
  return transaction(async (tx) => {
    const linked = await tx.workTask.update({ where: { id: task.id }, data: { sourceType: SALES_TASK_SOURCES[input.subjectType], sourceId: input.subjectId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.sales_task.created", resourceType: "work_task", resourceId: task.id, newValue: { subjectType: input.subjectType, subjectId: input.subjectId } });
    return linked;
  });
}

async function requireSalesTask(organizationId: string, companyId: string, taskId: string) {
  const t = isUuid(taskId) ? await db().workTask.findFirst({ where: { id: taskId, organizationId, companyId, archivedAt: null, sourceType: { in: SOURCE_TYPES } }, select: { id: true, status: true } }) : null;
  if (!t) throw notFound("Task");
  return t;
}

export async function updateSalesTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string, raw: z.input<typeof salesTaskPatch>) {
  const input = salesTaskPatch.parse(raw);
  await authorize(ctx, organizationId, companyId, "sales.manage");
  const t = await requireSalesTask(organizationId, companyId, taskId);
  return updateWorkTask(ctx, organizationId, companyId, t.id, {
    ...(input.done !== undefined ? { status: input.done ? "DONE" : "TODO" } : {}),
    ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId ?? "" } : {}),
    ...(input.dueDate !== undefined ? { dueDate: input.dueDate ?? "" } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.title ? { title: input.title } : {}),
  });
}

export async function deleteSalesTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string) {
  await authorize(ctx, organizationId, companyId, "sales.manage");
  const t = await requireSalesTask(organizationId, companyId, taskId);
  return archiveWorkTask(ctx, organizationId, companyId, t.id);
}

/** "My sales tasks": the viewer's open tasks linked to CRM records, plus ones completed in the last 7 days. */
export async function mySalesTasks(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const me = ctx.actor.id ?? ZERO_UUID;
  const base = { organizationId, companyId, archivedAt: null, assigneeId: me, sourceType: { in: SOURCE_TYPES } };
  const [open, done] = await Promise.all([
    db().workTask.findMany({ where: { ...base, status: { in: OPEN } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], take: 200, select }),
    db().workTask.findMany({ where: { ...base, status: "DONE", completedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, orderBy: { completedAt: "desc" }, take: 20, select }),
  ]);
  const ids = (type: string) => [...new Set([...open, ...done].filter((t) => t.sourceType === type && t.sourceId).map((t) => t.sourceId!))];
  const [deals, leads, accounts] = await Promise.all([
    db().crmDeal.findMany({ where: { id: { in: ids("crm_deal") }, companyId }, select: { id: true, name: true } }),
    db().lead.findMany({ where: { id: { in: ids("crm_lead") }, companyId }, select: { id: true, name: true } }),
    db().account.findMany({ where: { id: { in: ids("crm_account") }, companyId }, select: { id: true, name: true } }),
  ]);
  const names = new Map([...deals, ...leads, ...accounts].map((r) => [r.id, r.name]));
  const withSubject = <T extends { sourceType: string | null; sourceId: string | null }>(t: T) => ({ ...t, subjectName: t.sourceId ? (names.get(t.sourceId) ?? null) : null, href: subjectHref(t.sourceType, t.sourceId) });
  const todayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return { open: open.map(withSubject), done: done.map(withSubject), overdue: open.filter((t) => t.dueDate && t.dueDate < todayStart).length };
}
