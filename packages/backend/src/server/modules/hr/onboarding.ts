import { z } from "zod";
import type { HrChecklistKind, HrOwnerRole } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { actorId, authorize, day, employeeName, isUuid, money, myEmployee, optText, patchText, requireEmployee, toDay, toMinor, todayUtc, uuid } from "./access";

/**
 * Onboarding & offboarding: checklist templates (steps with relative due days and an owner role), checklist runs per
 * employee that create one WorkTask (sourceType "onboarding") per step, and the equipment/asset register.
 */

export const CHECKLIST_KINDS = ["ONBOARDING", "OFFBOARDING"] as const;
export const CHECKLIST_CATEGORIES = ["GENERAL", "ACCESS", "DOCUMENT", "EQUIPMENT", "TRAINING"] as const;
export const OWNER_ROLES = ["HR", "MANAGER", "EMPLOYEE", "IT"] as const;
export const ASSET_STATUSES = ["AVAILABLE", "ASSIGNED", "MAINTENANCE", "RETIRED"] as const;

export const templateInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(CHECKLIST_KINDS).default("ONBOARDING"),
  description: optText(1000),
  isDefault: z.boolean().default(false),
});
export const templatePatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: patchText(1000),
  isDefault: z.boolean().optional(),
});
export const templateTaskInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: optText(2000),
  category: z.enum(CHECKLIST_CATEGORIES).default("GENERAL"),
  ownerRole: z.enum(OWNER_ROLES).default("HR"),
  dueDays: z.coerce.number().int().min(-90).max(365).default(0),
});
export const startChecklistInput = z.object({
  employeeId: uuid,
  kind: z.enum(CHECKLIST_KINDS),
  templateId: uuid.optional().or(z.literal("").transform(() => undefined)),
  startDate: day.optional().or(z.literal("").transform(() => undefined)),
});
export const checklistItemInput = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.enum(CHECKLIST_CATEGORIES).default("GENERAL"),
  ownerRole: z.enum(OWNER_ROLES).default("HR"),
  dueDate: day.optional().or(z.literal("").transform(() => undefined)),
});
export const itemToggleInput = z.object({ done: z.boolean() });
export const assetInput = z.object({
  name: z.string().trim().min(1).max(160),
  tag: z.string().trim().min(1).max(60),
  category: z.string().trim().min(1).max(60).default("laptop"),
  serialNumber: optText(120),
  purchaseDate: day.optional().or(z.literal("").transform(() => undefined)),
  value: money.optional().or(z.literal("").transform(() => undefined)),
  notes: optText(2000),
});
export const assetPatch = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  serialNumber: patchText(120),
  status: z.enum(["AVAILABLE", "MAINTENANCE", "RETIRED"]).optional(),
  notes: patchText(2000),
});
export const assetAssignInput = z.object({
  action: z.enum(["assign", "return"]),
  employeeId: uuid.optional(),
  notes: optText(500),
});

const nil = (v?: string | null) => v || null;

const DEFAULT_STEPS: Record<HrChecklistKind, { title: string; category: (typeof CHECKLIST_CATEGORIES)[number]; ownerRole: HrOwnerRole; dueDays: number }[]> = {
  ONBOARDING: [
    { title: "Prepare employment contract and collect signed copy", category: "DOCUMENT", ownerRole: "HR", dueDays: -3 },
    { title: "Collect ID, tax and bank details", category: "DOCUMENT", ownerRole: "EMPLOYEE", dueDays: 0 },
    { title: "Prepare laptop and equipment", category: "EQUIPMENT", ownerRole: "IT", dueDays: -1 },
    { title: "Create email and platform accounts", category: "ACCESS", ownerRole: "IT", dueDays: -1 },
    { title: "Welcome meeting and team introduction", category: "GENERAL", ownerRole: "MANAGER", dueDays: 0 },
    { title: "Read and acknowledge company policies", category: "TRAINING", ownerRole: "EMPLOYEE", dueDays: 5 },
    { title: "Set 30/60/90-day goals", category: "GENERAL", ownerRole: "MANAGER", dueDays: 7 },
  ],
  OFFBOARDING: [
    { title: "Confirm last working day and exit paperwork", category: "DOCUMENT", ownerRole: "HR", dueDays: 0 },
    { title: "Knowledge transfer and handover", category: "GENERAL", ownerRole: "MANAGER", dueDays: 0 },
    { title: "Collect laptop and equipment", category: "EQUIPMENT", ownerRole: "IT", dueDays: 0 },
    { title: "Revoke email and platform access", category: "ACCESS", ownerRole: "IT", dueDays: 0 },
    { title: "Exit interview", category: "GENERAL", ownerRole: "HR", dueDays: 0 },
    { title: "Final pay and settlement", category: "DOCUMENT", ownerRole: "HR", dueDays: 7 },
  ],
};

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Platform user responsible for a step, by owner role (HR → the person starting it; IT → unassigned). */
async function ownerUser(tx: Tx, role: HrOwnerRole, employee: { userId: string | null; managerId: string | null }, ctx: RequestContext) {
  if (role === "EMPLOYEE") return employee.userId;
  if (role === "MANAGER") {
    if (!employee.managerId) return null;
    return (await tx.employee.findFirst({ where: { id: employee.managerId }, select: { userId: true } }))?.userId ?? null;
  }
  if (role === "HR") return ctx.actor.type === "USER" ? ctx.actor.id : null;
  return null;
}

/**
 * Start a checklist run inside the caller's transaction (used by hiring and lifecycle changes): steps from the template
 * (or the default template of that kind, or built-in steps), each with a WorkTask for its owner.
 */
export async function startChecklistTx(
  tx: Tx,
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  args: { employeeId: string; kind: HrChecklistKind; templateId?: string | null; startDate?: Date | null },
) {
  const employee = await requireEmployee(tx, organizationId, companyId, args.employeeId);
  const open = await tx.hrChecklist.findFirst({ where: { companyId, employeeId: employee.id, kind: args.kind, status: "IN_PROGRESS" }, select: { id: true } });
  if (open) return open;
  const template = args.templateId
    ? await tx.hrChecklistTemplate.findFirst({ where: { id: args.templateId, organizationId, companyId, archivedAt: null, kind: args.kind }, include: { tasks: { orderBy: { position: "asc" } } } })
    : await tx.hrChecklistTemplate.findFirst({ where: { organizationId, companyId, archivedAt: null, kind: args.kind, isDefault: true }, include: { tasks: { orderBy: { position: "asc" } } } });
  if (args.templateId && !template) throw notFound("Checklist template");
  const steps = template?.tasks.length ? template.tasks : DEFAULT_STEPS[args.kind].map((s) => ({ ...s, description: null }));
  const start = args.startDate ?? employee.startDate ?? todayUtc();
  const createdById = actorId(ctx, organizationId);
  const checklist = await tx.hrChecklist.create({
    data: { organizationId, companyId, employeeId: employee.id, templateId: template?.id ?? null, kind: args.kind, startDate: start, createdById },
  });
  const name = employeeName(employee);
  const label = args.kind === "ONBOARDING" ? "onboarding" : "offboarding";
  for (const [i, s] of steps.entries()) {
    const dueDate = addDays(start, s.dueDays);
    const task = await tx.workTask.create({
      data: {
        organizationId,
        companyId,
        title: `${s.title} — ${name}`.slice(0, 250),
        description: s.description ?? null,
        assigneeId: await ownerUser(tx, s.ownerRole, employee, ctx),
        dueDate,
        labels: [label, s.category.toLowerCase()],
        sourceType: "onboarding",
        sourceId: checklist.id,
        createdById,
      },
      select: { id: true },
    });
    await tx.hrChecklistItem.create({
      data: { organizationId, companyId, checklistId: checklist.id, title: s.title, description: s.description ?? null, category: s.category, ownerRole: s.ownerRole, dueDate, position: i, workTaskId: task.id },
    });
  }
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `hr.${label}.started`, resourceType: "hr_checklist", resourceId: checklist.id, newValue: { employeeId: employee.id, steps: steps.length } });
  return checklist;
}

export async function listTemplates(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  return db().hrChecklistTemplate.findMany({ take: 500,
    where: { organizationId, companyId, archivedAt: null },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: { tasks: { orderBy: { position: "asc" } } },
  });
}

async function requireTemplate(tx: Tx, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Checklist template");
  const t = await tx.hrChecklistTemplate.findFirst({ where: { id, organizationId, companyId, archivedAt: null } });
  if (!t) throw notFound("Checklist template");
  return t;
}

export async function createTemplate(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof templateInput>) {
  const input = templateInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (input.isDefault) await tx.hrChecklistTemplate.updateMany({ where: { companyId, kind: input.kind }, data: { isDefault: false } });
    const t = await tx.hrChecklistTemplate.create({ data: { organizationId, companyId, name: input.name, kind: input.kind, description: nil(input.description), isDefault: input.isDefault } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.checklist_template.created", resourceType: "hr_checklist_template", resourceId: t.id, newValue: input });
    return t;
  });
}

export async function updateTemplate(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof templatePatch>) {
  const input = templatePatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const t = await requireTemplate(tx, organizationId, companyId, id);
    if (input.isDefault) await tx.hrChecklistTemplate.updateMany({ where: { companyId, kind: t.kind }, data: { isDefault: false } });
    const updated = await tx.hrChecklistTemplate.update({
      where: { id },
      data: { ...(input.name ? { name: input.name } : {}), ...(input.description !== undefined ? { description: nil(input.description) } : {}), ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.checklist_template.updated", resourceType: "hr_checklist_template", resourceId: id, newValue: input });
    return updated;
  });
}

export async function archiveTemplate(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    await requireTemplate(tx, organizationId, companyId, id);
    await tx.hrChecklistTemplate.update({ where: { id }, data: { archivedAt: new Date(), isDefault: false } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.checklist_template.archived", resourceType: "hr_checklist_template", resourceId: id });
    return { ok: true };
  });
}

export async function addTemplateTask(ctx: RequestContext, organizationId: string, companyId: string, templateId: string, raw: z.input<typeof templateTaskInput>) {
  const input = templateTaskInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    await requireTemplate(tx, organizationId, companyId, templateId);
    const position = await tx.hrChecklistTemplateTask.count({ where: { templateId } });
    const task = await tx.hrChecklistTemplateTask.create({ data: { organizationId, companyId, templateId, ...input, description: nil(input.description), position } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.checklist_template.task_added", resourceType: "hr_checklist_template", resourceId: templateId, newValue: input });
    return task;
  });
}

export async function removeTemplateTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (!isUuid(taskId)) throw notFound("Template task");
    const { count } = await tx.hrChecklistTemplateTask.deleteMany({ where: { id: taskId, organizationId, companyId } });
    if (!count) throw notFound("Template task");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.checklist_template.task_removed", resourceType: "hr_checklist_template_task", resourceId: taskId });
    return { ok: true };
  });
}

export async function startChecklist(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof startChecklistInput>) {
  const input = startChecklistInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const existing = await tx.hrChecklist.findFirst({ where: { companyId, employeeId: input.employeeId, kind: input.kind, status: "IN_PROGRESS" }, select: { id: true } });
    if (existing) throw conflict("This employee already has an open checklist of this kind", { reason: "hr_checklist_open", checklistId: existing.id });
    return startChecklistTx(tx, ctx, organizationId, companyId, { employeeId: input.employeeId, kind: input.kind, templateId: input.templateId, startDate: toDay(input.startDate) });
  });
}

/** A step is done when checked here or when its WorkTask was completed in the Work module. */
const itemDone = (item: { completedAt: Date | null; workTaskId: string | null }, taskStatus: Map<string, string>) =>
  !!item.completedAt || (item.workTaskId ? taskStatus.get(item.workTaskId) === "DONE" : false);

async function withProgress<T extends { items: { completedAt: Date | null; workTaskId: string | null }[] }>(companyId: string, lists: T[]) {
  const ids = lists.flatMap((l) => l.items.map((i) => i.workTaskId).filter((v): v is string => !!v));
  const tasks = ids.length ? await db().workTask.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, status: true, assigneeId: true } }) : [];
  const status = new Map(tasks.map((t) => [t.id, t.status as string]));
  return lists.map((l) => {
    const done = l.items.filter((i) => itemDone(i, status)).length;
    return { ...l, done, total: l.items.length, percent: l.items.length ? Math.round((done / l.items.length) * 100) : 100, taskStatus: status };
  });
}

export async function listChecklists(ctx: RequestContext, organizationId: string, companyId: string, filters: { status?: "IN_PROGRESS" | "COMPLETED" | "CANCELLED"; kind?: HrChecklistKind } = {}) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  const lists = await db().hrChecklist.findMany({
    where: { organizationId, companyId, ...(filters.status ? { status: filters.status } : {}), ...(filters.kind ? { kind: filters.kind } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { employee: { select: { id: true, firstName: true, lastName: true, title: true } }, items: { select: { completedAt: true, workTaskId: true } } },
  });
  return withProgress(companyId, lists);
}

export async function getChecklist(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Checklist");
  const list = await db().hrChecklist.findFirst({
    where: { id, organizationId, companyId },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, title: true, userId: true, managerId: true } },
      template: { select: { id: true, name: true } },
      items: { orderBy: { position: "asc" } },
    },
  });
  if (!list) throw notFound("Checklist");
  // HR managers, or the employee themselves (to see their own onboarding).
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  if (me?.id !== list.employeeId) await authorize(ctx, organizationId, companyId, "hr.manage");
  else await authorize(ctx, organizationId, companyId, "hr.read");
  const [withP] = await withProgress(companyId, [list]);
  return withP!;
}

/** Check or uncheck a step; its WorkTask follows. The checklist completes automatically when every step is done. */
export async function toggleChecklistItem(ctx: RequestContext, organizationId: string, companyId: string, itemId: string, raw: z.input<typeof itemToggleInput>) {
  const { done } = itemToggleInput.parse(raw);
  return transaction(async (tx) => {
    if (!isUuid(itemId)) throw notFound("Checklist item");
    const item = await tx.hrChecklistItem.findFirst({ where: { id: itemId, organizationId, companyId }, include: { checklist: true } });
    if (!item) throw notFound("Checklist item");
    const me = await myEmployee(tx, ctx, organizationId, companyId);
    // The employee may tick their own steps; everything else needs hr.manage.
    if (!(me && me.id === item.checklist.employeeId && item.ownerRole === "EMPLOYEE")) await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    else await authorize(ctx, organizationId, companyId, "hr.read", tx);
    if (item.checklist.status === "CANCELLED") throw invalid("This checklist was cancelled");
    await tx.hrChecklistItem.update({ where: { id: itemId }, data: done ? { completedAt: new Date(), completedById: ctx.actor.id } : { completedAt: null, completedById: null } });
    if (item.workTaskId) {
      await tx.workTask.updateMany({ where: { id: item.workTaskId, companyId }, data: done ? { status: "DONE", completedAt: new Date() } : { status: "TODO", completedAt: null } });
    }
    await syncChecklistStatus(tx, companyId, item.checklistId);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: done ? "hr.checklist.item_done" : "hr.checklist.item_reopened", resourceType: "hr_checklist", resourceId: item.checklistId, newValue: { itemId, title: item.title } });
    return { ok: true };
  });
}

/** Mark a checklist completed when all of its steps are done (or reopen it when one is unchecked). */
export async function syncChecklistStatus(tx: Tx, companyId: string, checklistId: string) {
  const list = await tx.hrChecklist.findFirst({ where: { id: checklistId, companyId }, include: { items: { select: { completedAt: true, workTaskId: true } } } });
  if (!list || list.status === "CANCELLED") return;
  const ids = list.items.map((i) => i.workTaskId).filter((v): v is string => !!v);
  const tasks = ids.length ? await tx.workTask.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, status: true } }) : [];
  const status = new Map(tasks.map((t) => [t.id, t.status as string]));
  const allDone = list.items.every((i) => itemDone(i, status));
  if (allDone && list.status !== "COMPLETED") await tx.hrChecklist.update({ where: { id: checklistId }, data: { status: "COMPLETED", completedAt: new Date() } });
  if (!allDone && list.status === "COMPLETED") await tx.hrChecklist.update({ where: { id: checklistId }, data: { status: "IN_PROGRESS", completedAt: null } });
}

export async function addChecklistItem(ctx: RequestContext, organizationId: string, companyId: string, checklistId: string, raw: z.input<typeof checklistItemInput>) {
  const input = checklistItemInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (!isUuid(checklistId)) throw notFound("Checklist");
    const list = await tx.hrChecklist.findFirst({ where: { id: checklistId, organizationId, companyId, status: { not: "CANCELLED" } }, include: { employee: true } });
    if (!list) throw notFound("Checklist");
    const position = await tx.hrChecklistItem.count({ where: { checklistId } });
    const dueDate = toDay(input.dueDate);
    const task = await tx.workTask.create({
      data: {
        organizationId,
        companyId,
        title: `${input.title} — ${employeeName(list.employee)}`.slice(0, 250),
        assigneeId: await ownerUser(tx, input.ownerRole, list.employee, ctx),
        dueDate,
        labels: [list.kind.toLowerCase(), input.category.toLowerCase()],
        sourceType: "onboarding",
        sourceId: list.id,
        createdById: actorId(ctx, organizationId),
      },
      select: { id: true },
    });
    const item = await tx.hrChecklistItem.create({ data: { organizationId, companyId, checklistId, ...input, dueDate, position, workTaskId: task.id } });
    if (list.status === "COMPLETED") await tx.hrChecklist.update({ where: { id: list.id }, data: { status: "IN_PROGRESS", completedAt: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.checklist.item_added", resourceType: "hr_checklist", resourceId: checklistId, newValue: input });
    return item;
  });
}

export async function cancelChecklist(ctx: RequestContext, organizationId: string, companyId: string, checklistId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (!isUuid(checklistId)) throw notFound("Checklist");
    const list = await tx.hrChecklist.findFirst({ where: { id: checklistId, organizationId, companyId, status: "IN_PROGRESS" }, include: { items: { where: { completedAt: null }, select: { workTaskId: true } } } });
    if (!list) throw notFound("Checklist");
    await tx.hrChecklist.update({ where: { id: checklistId }, data: { status: "CANCELLED" } });
    const ids = list.items.map((i) => i.workTaskId).filter((v): v is string => !!v);
    if (ids.length) await tx.workTask.updateMany({ where: { id: { in: ids }, companyId, status: { notIn: ["DONE", "CANCELLED"] } }, data: { status: "CANCELLED" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.checklist.cancelled", resourceType: "hr_checklist", resourceId: checklistId });
    return { ok: true };
  });
}

// ─── Assets ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function listAssets(ctx: RequestContext, organizationId: string, companyId: string, filters: { q?: string; status?: (typeof ASSET_STATUSES)[number] } = {}) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  const contains = filters.q ? { contains: filters.q, mode: "insensitive" as const } : undefined;
  return db().hrAsset.findMany({
    where: {
      organizationId,
      companyId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(contains ? { OR: [{ name: contains }, { tag: contains }, { serialNumber: contains }, { category: contains }] } : {}),
    },
    orderBy: [{ status: "asc" }, { tag: "asc" }],
    take: 500,
    include: {
      assignments: { orderBy: { assignedAt: "desc" }, take: 10, include: { employee: { select: { id: true, firstName: true, lastName: true } } } },
    },
  });
}

export async function createAsset(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof assetInput>) {
  const input = assetInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
    const a = await tx.hrAsset
      .create({
        data: {
          organizationId,
          companyId,
          name: input.name,
          tag: input.tag,
          category: input.category,
          serialNumber: nil(input.serialNumber),
          purchaseDate: toDay(input.purchaseDate),
          valueMinor: toMinor(input.value, company.baseCurrency),
          currency: input.value ? company.baseCurrency : null,
          notes: nil(input.notes),
        },
      })
      .catch((e: { code?: string }) => {
        if (e?.code === "P2002") throw conflict("An asset with this tag already exists", { reason: "hr_asset_tag_taken" });
        throw e;
      });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.asset.created", resourceType: "hr_asset", resourceId: a.id, newValue: { ...input } });
    return a;
  });
}

export async function updateAsset(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof assetPatch>) {
  const input = assetPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (!isUuid(id)) throw notFound("Asset");
    const a = await tx.hrAsset.findFirst({ where: { id, organizationId, companyId } });
    if (!a) throw notFound("Asset");
    if (input.status && a.status === "ASSIGNED") throw invalid("Return the asset before changing its status", { reason: "hr_asset_assigned" });
    const updated = await tx.hrAsset.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.serialNumber !== undefined ? { serialNumber: nil(input.serialNumber) } : {}),
        ...(input.notes !== undefined ? { notes: nil(input.notes) } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.asset.updated", resourceType: "hr_asset", resourceId: id, oldValue: { status: a.status }, newValue: input });
    return updated;
  });
}

/** Assign an available asset to an employee, or record its return. Every change is kept as assignment history. */
export async function assignAsset(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof assetAssignInput>) {
  const input = assetAssignInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (!isUuid(id)) throw notFound("Asset");
    const a = await tx.hrAsset.findFirst({ where: { id, organizationId, companyId } });
    if (!a) throw notFound("Asset");
    if (input.action === "assign") {
      if (a.status !== "AVAILABLE") throw invalid("This asset is not available", { reason: "hr_asset_unavailable" });
      if (!input.employeeId) throw invalid("Choose an employee");
      const e = await requireEmployee(tx, organizationId, companyId, input.employeeId);
      await tx.hrAssetAssignment.create({ data: { organizationId, companyId, assetId: id, employeeId: e.id, notes: nil(input.notes), assignedById: ctx.actor.id } });
      await tx.hrAsset.update({ where: { id }, data: { status: "ASSIGNED" } });
    } else {
      const open = await tx.hrAssetAssignment.findFirst({ where: { assetId: id, companyId, returnedAt: null } });
      if (!open) throw invalid("This asset is not assigned");
      await tx.hrAssetAssignment.update({ where: { id: open.id }, data: { returnedAt: new Date(), notes: input.notes ? [open.notes, input.notes].filter(Boolean).join(" · ") : open.notes } });
      await tx.hrAsset.update({ where: { id }, data: { status: "AVAILABLE" } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `hr.asset.${input.action === "assign" ? "assigned" : "returned"}`, resourceType: "hr_asset", resourceId: id, newValue: input });
    return { ok: true };
  });
}

/** Assets currently held by an employee (HR managers or the employee). */
export async function employeeAssets(organizationId: string, companyId: string, employeeId: string) {
  return db().hrAssetAssignment.findMany({
    where: { organizationId, companyId, employeeId },
    orderBy: { assignedAt: "desc" },
    take: 50,
    include: { asset: { select: { id: true, name: true, tag: true, category: true } } },
  });
}

/** JSON-friendly checklist for the API. */
export async function getChecklistApi(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  const { taskStatus, ...list } = await getChecklist(ctx, organizationId, companyId, id);
  return { ...list, taskStatus: Object.fromEntries(taskStatus) };
}

/** Checklists and asset assignments of one employee (HR managers or the employee). */
export async function onboardingOf(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string) {
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  await authorize(ctx, organizationId, companyId, me?.id === employeeId ? "hr.read" : "hr.manage");
  const lists = await db().hrChecklist.findMany({ take: 500, where: { organizationId, companyId, employeeId }, orderBy: { createdAt: "desc" }, include: { items: { select: { completedAt: true, workTaskId: true } } } });
  const checklists = (await withProgress(companyId, lists)).map((l) => ({ id: l.id, kind: l.kind, status: l.status, startDate: l.startDate, done: l.done, total: l.total, percent: l.percent }));
  return { checklists, assets: await employeeAssets(organizationId, companyId, employeeId) };
}
