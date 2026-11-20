import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { OpsAssetStatus, OpsIncidentSeverity, OpsIncidentStatus, OpsSchedule } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { actorId, addDays, addMonths, authorize, blank, isUuid, oneOf, optDay, optMoney, optText, optUuid, PAGE_SIZE, pageParam, param, requireEligible, toDay, today, toMinor, userNames } from "./shared";

export const SCHEDULES = ["NONE", "DAILY", "WEEKLY", "MONTHLY"] as const;
export const ASSET_STATUSES = ["AVAILABLE", "IN_USE", "MAINTENANCE", "RETIRED"] as const;
export const SEVERITIES = ["SEV1", "SEV2", "SEV3", "SEV4"] as const;
export const INCIDENT_STATUSES = ["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED", "CLOSED"] as const;

const audit = (tx: Tx, ctx: RequestContext, organizationId: string, action: string, resourceType: string, resourceId: string, newValue?: unknown, oldValue?: unknown) =>
  writeAudit(tx, ctx, { category: "TENANT", organizationId, action, resourceType, resourceId, newValue, oldValue });

async function findIn<T>(fn: () => Promise<T | null>, what: string, id: string) {
  if (!isUuid(id)) throw notFound(what);
  const r = await fn();
  if (!r) throw notFound(what);
  return r;
}

// ─── SOPs / processes ───

const steps = z.array(z.object({ title: z.string().trim().min(1).max(300), detail: z.string().trim().max(5000).optional() })).min(1).max(200);
export type ProcessStep = z.infer<typeof steps>[number];

export const processInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: optText(5000),
  category: optText(80),
  ownerId: optUuid,
  steps,
});
export const updateProcessInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: optText(5000),
  category: optText(80),
  ownerId: optUuid,
  archived: z.boolean().optional(),
});
export const processVersionInput = z.object({ steps, changeNote: z.string().trim().max(500).optional() });

export async function listProcesses(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, string | string[] | undefined>) {
  await authorize(ctx, organizationId, companyId, "operations.read");
  const q = param(raw, "q")?.slice(0, 200);
  const category = param(raw, "category")?.slice(0, 80);
  const page = pageParam(raw);
  const where: Prisma.OpsProcessWhereInput = { organizationId, companyId, archivedAt: param(raw, "archived") === "1" ? { not: null } : null };
  if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }];
  if (category) where.category = category;
  const [total, rows, categories] = await Promise.all([
    db().opsProcess.count({ where }),
    db().opsProcess.findMany({ where, orderBy: [{ category: "asc" }, { title: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db().opsProcess.findMany({ where: { organizationId, companyId, category: { not: null } }, distinct: ["category"], select: { category: true }, take: 100 }),
  ]);
  const names = await userNames(db(), rows.map((r) => r.ownerId));
  return { data: rows.map((r) => ({ ...r, ownerName: r.ownerId ? (names.get(r.ownerId) ?? null) : null })), total, page, pageSize: PAGE_SIZE, categories: categories.map((c) => c.category!).sort() };
}

export async function getProcess(ctx: RequestContext, organizationId: string, companyId: string, id: string, version?: number) {
  await authorize(ctx, organizationId, companyId, "operations.read");
  const p = await findIn(() => db().opsProcess.findFirst({ where: { id, organizationId, companyId }, include: { versions: { orderBy: { version: "desc" }, take: 100 } } }), "Process", id);
  const shown = p.versions.find((v) => v.version === (version ?? p.currentVersion)) ?? p.versions[0];
  const names = await userNames(db(), [p.ownerId, ...p.versions.map((v) => v.createdById)]);
  return {
    ...p,
    ownerName: p.ownerId ? (names.get(p.ownerId) ?? null) : null,
    shown: shown ? { ...shown, steps: steps.safeParse(shown.steps).data ?? [] } : null,
    versions: p.versions.map((v) => ({ id: v.id, version: v.version, changeNote: v.changeNote, createdAt: v.createdAt, createdByName: names.get(v.createdById) ?? null })),
  };
}

export async function createProcess(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof processInput>) {
  const input = processInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "operations.manage", tx);
    const ownerId = blank(input.ownerId) ?? null;
    if (ownerId) await requireEligible(tx, organizationId, chain, ownerId, "operations.read");
    const p = await tx.opsProcess.create({
      data: { organizationId, companyId, title: input.title, description: blank(input.description) ?? null, category: blank(input.category) ?? null, ownerId, currentVersion: 1, createdById: actorId(ctx, organizationId) },
    });
    await tx.opsProcessVersion.create({ data: { organizationId, companyId, processId: p.id, version: 1, steps: input.steps, changeNote: null, createdById: actorId(ctx, organizationId) } });
    await audit(tx, ctx, organizationId, "ops_process.created", "ops_process", p.id, { title: p.title, steps: input.steps.length });
    return p;
  });
}

export async function updateProcess(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateProcessInput>) {
  const input = updateProcessInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "operations.manage", tx);
    const before = await findIn(() => tx.opsProcess.findFirst({ where: { id, organizationId, companyId } }), "Process", id);
    const ownerId = input.ownerId === undefined ? undefined : (blank(input.ownerId) ?? null);
    if (ownerId) await requireEligible(tx, organizationId, chain, ownerId, "operations.read");
    const p = await tx.opsProcess.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: blank(input.description) ?? null } : {}),
        ...(input.category !== undefined ? { category: blank(input.category) ?? null } : {}),
        ...(ownerId !== undefined ? { ownerId } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? (before.archivedAt ?? new Date()) : null } : {}),
      },
    });
    await audit(tx, ctx, organizationId, "ops_process.updated", "ops_process", id, input);
    return p;
  });
}

/** Save new steps as the next version (previous versions are kept). */
export async function addProcessVersion(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof processVersionInput>) {
  const input = processVersionInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "operations.manage", tx);
    const p = await findIn(() => tx.opsProcess.findFirst({ where: { id, organizationId, companyId } }), "Process", id);
    const last = await tx.opsProcessVersion.findFirst({ where: { processId: id }, orderBy: { version: "desc" }, select: { version: true } });
    const version = (last?.version ?? 0) + 1;
    await tx.opsProcessVersion.create({ data: { organizationId, companyId, processId: id, version, steps: input.steps, changeNote: input.changeNote || null, createdById: actorId(ctx, organizationId) } });
    await tx.opsProcess.update({ where: { id }, data: { currentVersion: version } });
    await audit(tx, ctx, organizationId, "ops_process.versioned", "ops_process", id, { version, steps: input.steps.length }, { version: p.currentVersion });
    return { version };
  });
}

// ─── Checklists ───

const checklistItems = z.array(z.string().trim().min(1).max(300)).min(1).max(100);
export interface ChecklistItem {
  id: string;
  text: string;
}
export interface RunItem extends ChecklistItem {
  done: boolean;
  doneById?: string | null;
  doneAt?: string | null;
}

export const checklistInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: optText(2000),
  items: checklistItems,
  schedule: z.enum(SCHEDULES).default("NONE"),
  /** First scheduled run (defaults to today when scheduled). */
  nextRunOn: optDay,
  assigneeId: optUuid,
});
export const updateChecklistInput = checklistInput.partial().extend({ archived: z.boolean().optional() });
export const runItemInput = z.object({ itemId: z.string().min(1).max(64), done: z.boolean() });

const parseItems = (v: unknown): ChecklistItem[] => (Array.isArray(v) ? (v as ChecklistItem[]).filter((i) => i && typeof i.id === "string" && typeof i.text === "string") : []);
const parseRunItems = (v: unknown): RunItem[] => (Array.isArray(v) ? (v as RunItem[]).filter((i) => i && typeof i.id === "string") : []);

export function nextScheduleDate(from: Date, schedule: OpsSchedule) {
  if (schedule === "DAILY") return addDays(from, 1);
  if (schedule === "WEEKLY") return addDays(from, 7);
  if (schedule === "MONTHLY") return addMonths(from, 1);
  return null;
}

export async function listChecklists(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, string | string[] | undefined>) {
  await authorize(ctx, organizationId, companyId, "operations.read");
  const q = param(raw, "q")?.slice(0, 200);
  const schedule = oneOf(SCHEDULES, param(raw, "schedule"));
  const where: Prisma.OpsChecklistWhereInput = { organizationId, companyId, archivedAt: param(raw, "archived") === "1" ? { not: null } : null };
  if (q) where.title = { contains: q, mode: "insensitive" };
  if (schedule) where.schedule = schedule;
  const rows = await db().opsChecklist.findMany({
    where,
    orderBy: { title: "asc" },
    take: 300,
    include: { runs: { orderBy: { dueOn: "desc" }, take: 1, select: { id: true, dueOn: true, completedAt: true, items: true } } },
  });
  const names = await userNames(db(), rows.map((r) => r.assigneeId));
  return rows.map((r) => {
    const last = r.runs[0];
    const items = last ? parseRunItems(last.items) : [];
    return {
      ...r,
      itemCount: parseItems(r.items).length,
      assigneeName: r.assigneeId ? (names.get(r.assigneeId) ?? null) : null,
      lastRun: last ? { id: last.id, dueOn: last.dueOn, completedAt: last.completedAt, done: items.filter((i) => i.done).length, total: items.length } : null,
    };
  });
}

export async function getChecklist(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "operations.read");
  const c = await findIn(() => db().opsChecklist.findFirst({ where: { id, organizationId, companyId }, include: { runs: { orderBy: { dueOn: "desc" }, take: 30 } } }), "Checklist", id);
  const runs = c.runs.map((r) => ({ ...r, items: parseRunItems(r.items) }));
  const names = await userNames(db(), [c.assigneeId, ...runs.flatMap((r) => r.items.map((i) => i.doneById))]);
  return { ...c, items: parseItems(c.items), runs, assigneeName: c.assigneeId ? (names.get(c.assigneeId) ?? null) : null, names: Object.fromEntries(names) };
}

export async function createChecklist(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof checklistInput>) {
  const input = checklistInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "operations.manage", tx);
    const assigneeId = blank(input.assigneeId) ?? null;
    if (assigneeId) await requireEligible(tx, organizationId, chain, assigneeId, "operations.read");
    const c = await tx.opsChecklist.create({
      data: {
        organizationId,
        companyId,
        title: input.title,
        description: blank(input.description) ?? null,
        items: input.items.map((text) => ({ id: randomUUID(), text })),
        schedule: input.schedule,
        nextRunOn: input.schedule === "NONE" ? null : (toDay(blank(input.nextRunOn)) ?? today()),
        assigneeId,
        createdById: actorId(ctx, organizationId),
      },
    });
    await audit(tx, ctx, organizationId, "ops_checklist.created", "ops_checklist", c.id, { title: c.title, schedule: c.schedule });
    return c;
  });
}

export async function updateChecklist(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateChecklistInput>) {
  const input = updateChecklistInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "operations.manage", tx);
    const before = await findIn(() => tx.opsChecklist.findFirst({ where: { id, organizationId, companyId } }), "Checklist", id);
    const data: Prisma.OpsChecklistUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = blank(input.description) ?? null;
    if (input.items !== undefined) {
      // Keep ids of unchanged texts so history stays readable.
      const old = parseItems(before.items);
      data.items = input.items.map((text) => ({ id: old.find((o) => o.text === text)?.id ?? randomUUID(), text }));
    }
    if (input.assigneeId !== undefined) {
      const a = blank(input.assigneeId) ?? null;
      if (a) await requireEligible(tx, organizationId, chain, a, "operations.read");
      data.assigneeId = a;
    }
    const schedule = input.schedule ?? before.schedule;
    if (input.schedule !== undefined) data.schedule = input.schedule;
    if (input.nextRunOn !== undefined || input.schedule !== undefined) data.nextRunOn = schedule === "NONE" ? null : (toDay(blank(input.nextRunOn)) ?? before.nextRunOn ?? today());
    if (input.archived !== undefined) data.archivedAt = input.archived ? (before.archivedAt ?? new Date()) : null;
    const c = await tx.opsChecklist.update({ where: { id }, data });
    await audit(tx, ctx, organizationId, "ops_checklist.updated", "ops_checklist", id, input);
    return c;
  });
}

async function openRun(tx: Tx, checklist: { id: string; organizationId: string; companyId: string; items: unknown }, dueOn: Date) {
  const existing = await tx.opsChecklistRun.findUnique({ where: { checklistId_dueOn: { checklistId: checklist.id, dueOn } } });
  if (existing) return { run: existing, created: false };
  const run = await tx.opsChecklistRun.create({
    data: { organizationId: checklist.organizationId, companyId: checklist.companyId, checklistId: checklist.id, dueOn, items: parseItems(checklist.items).map((i) => ({ ...i, done: false })) },
  });
  return { run, created: true };
}

/** Start a run now (manual). */
export async function startChecklistRun(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "operations.read", tx);
    const c = await findIn(() => tx.opsChecklist.findFirst({ where: { id, organizationId, companyId, archivedAt: null } }), "Checklist", id);
    const { run, created } = await openRun(tx, c, today());
    if (created) await audit(tx, ctx, organizationId, "ops_checklist.run_started", "ops_checklist", id, { runId: run.id });
    return run;
  });
}

/** Tick or untick an item of a run; the run completes when every item is done. */
export async function setRunItem(ctx: RequestContext, organizationId: string, companyId: string, runId: string, raw: z.input<typeof runItemInput>) {
  const input = runItemInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "operations.read", tx);
    const run = await findIn(() => tx.opsChecklistRun.findFirst({ where: { id: runId, organizationId, companyId } }), "Run", runId);
    const items = parseRunItems(run.items);
    const item = items.find((i) => i.id === input.itemId);
    if (!item) throw notFound("Item");
    item.done = input.done;
    item.doneById = input.done ? (ctx.actor.id ?? null) : null;
    item.doneAt = input.done ? new Date().toISOString() : null;
    const complete = items.every((i) => i.done);
    const r = await tx.opsChecklistRun.update({ where: { id: runId }, data: { items: items as unknown as Prisma.InputJsonValue, completedAt: complete ? (run.completedAt ?? new Date()) : null } });
    await audit(tx, ctx, organizationId, "ops_checklist.item_set", "ops_checklist_run", runId, input);
    return r;
  });
}

/** Periodic job: open the due run of every scheduled checklist and advance its schedule; notifies the assignee. */
export async function openDueChecklistRuns(now = new Date()) {
  const due = await db().opsChecklist.findMany({ where: { archivedAt: null, schedule: { not: "NONE" }, nextRunOn: { lte: today(now) } }, take: 500 });
  const ctx = systemContext();
  let opened = 0;
  for (const c of due) {
    await transaction(async (tx) => {
      const fresh = await tx.opsChecklist.findUnique({ where: { id: c.id } });
      if (!fresh?.nextRunOn || fresh.nextRunOn > today(now) || fresh.schedule === "NONE") return;
      const { created } = await openRun(tx, fresh, fresh.nextRunOn);
      let next = nextScheduleDate(fresh.nextRunOn, fresh.schedule)!;
      while (next <= today(now)) next = nextScheduleDate(next, fresh.schedule)!; // skip missed periods
      await tx.opsChecklist.update({ where: { id: fresh.id }, data: { nextRunOn: next } });
      if (created) {
        opened++;
        await writeAudit(tx, ctx, { category: "TENANT", organizationId: fresh.organizationId, action: "ops_checklist.run_opened", resourceType: "ops_checklist", resourceId: fresh.id });
        const to = fresh.assigneeId ? [fresh.assigneeId] : await usersWithPermission(tx, fresh.organizationId, fresh.companyId, "operations.manage");
        await notifyUsers(tx, fresh.organizationId, to, "work.checklistDue", { companyId: fresh.companyId, title: fresh.title, href: `/operations/checklists/${fresh.id}` });
      }
    });
  }
  return opened;
}

// ─── Assets ───

export const assetInput = z.object({
  name: z.string().trim().min(1).max(200),
  assetTag: optText(60),
  category: optText(80),
  serialNumber: optText(120),
  location: optText(200),
  status: z.enum(ASSET_STATUSES).default("AVAILABLE"),
  assignedToId: optUuid,
  purchaseDate: optDay,
  cost: optMoney,
  notes: optText(4000),
});
export const updateAssetInput = assetInput.partial().extend({ archived: z.boolean().optional() });

export async function listAssets(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, string | string[] | undefined>) {
  await authorize(ctx, organizationId, companyId, "operations.read");
  const q = param(raw, "q")?.slice(0, 200);
  const status = oneOf(ASSET_STATUSES, param(raw, "status"));
  const category = param(raw, "category")?.slice(0, 80);
  const sort = oneOf(["name", "status", "purchase", "created"] as const, param(raw, "sort")) ?? "name";
  const page = pageParam(raw);
  const where: Prisma.OpsAssetWhereInput = { organizationId, companyId, archivedAt: param(raw, "archived") === "1" ? { not: null } : null };
  if (status) where.status = status;
  if (category) where.category = category;
  if (q) where.OR = ["name", "assetTag", "serialNumber", "location"].map((k) => ({ [k]: { contains: q, mode: "insensitive" } }));
  const orderBy: Prisma.OpsAssetOrderByWithRelationInput[] =
    sort === "status" ? [{ status: "asc" }, { name: "asc" }] : sort === "purchase" ? [{ purchaseDate: { sort: "desc", nulls: "last" } }] : sort === "created" ? [{ createdAt: "desc" }] : [{ name: "asc" }];
  const [total, rows, categories, value] = await Promise.all([
    db().opsAsset.count({ where }),
    db().opsAsset.findMany({ where, orderBy, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db().opsAsset.findMany({ where: { organizationId, companyId, category: { not: null } }, distinct: ["category"], select: { category: true }, take: 100 }),
    db().opsAsset.groupBy({ by: ["currency"], where: { organizationId, companyId, archivedAt: null, status: { not: "RETIRED" } }, _sum: { costMinor: true } }),
  ]);
  const names = await userNames(db(), rows.map((r) => r.assignedToId));
  return {
    data: rows.map((r) => ({ ...r, assignedToName: r.assignedToId ? (names.get(r.assignedToId) ?? null) : null })),
    total,
    page,
    pageSize: PAGE_SIZE,
    categories: categories.map((c) => c.category!).sort(),
    value: value.filter((v) => v.currency && v._sum.costMinor != null).map((v) => ({ currency: v.currency!, amountMinor: v._sum.costMinor! })),
  };
}

function assetData(input: z.infer<typeof updateAssetInput>): Prisma.OpsAssetUncheckedUpdateInput {
  const d: Prisma.OpsAssetUncheckedUpdateInput = {};
  if (input.name !== undefined) d.name = input.name;
  for (const k of ["assetTag", "category", "serialNumber", "location", "notes"] as const) if (input[k] !== undefined) d[k] = blank(input[k]) ?? null;
  if (input.status !== undefined) d.status = input.status as OpsAssetStatus;
  if (input.purchaseDate !== undefined) d.purchaseDate = toDay(blank(input.purchaseDate));
  if (input.cost !== undefined) d.costMinor = toMinor(blank(input.cost));
  return d;
}

export async function createAsset(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof assetInput>) {
  const input = assetInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "operations.manage", tx);
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId }, select: { baseCurrency: true } });
    const assignedToId = blank(input.assignedToId) ?? null;
    if (assignedToId) await requireEligible(tx, organizationId, chain, assignedToId, "operations.read").catch(async () => requireEligible(tx, organizationId, chain, assignedToId, "projects.read"));
    const tag = blank(input.assetTag);
    if (tag && (await tx.opsAsset.findFirst({ where: { companyId, assetTag: tag }, select: { id: true } }))) throw conflict("This asset tag is in use", { reason: "work_asset_tag_taken" });
    const a = await tx.opsAsset.create({
      data: {
        ...(assetData(input) as Prisma.OpsAssetUncheckedCreateInput),
        organizationId,
        companyId,
        name: input.name,
        status: assignedToId && input.status === "AVAILABLE" ? "IN_USE" : input.status,
        assignedToId,
        currency: company.baseCurrency,
        createdById: actorId(ctx, organizationId),
      },
    });
    await audit(tx, ctx, organizationId, "ops_asset.created", "ops_asset", a.id, { name: a.name, assetTag: a.assetTag });
    return a;
  });
}

export async function updateAsset(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateAssetInput>) {
  const input = updateAssetInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "operations.manage", tx);
    const before = await findIn(() => tx.opsAsset.findFirst({ where: { id, organizationId, companyId } }), "Asset", id);
    const data = assetData(input);
    if (input.assetTag !== undefined) {
      const tag = blank(input.assetTag);
      if (tag && tag !== before.assetTag && (await tx.opsAsset.findFirst({ where: { companyId, assetTag: tag }, select: { id: true } }))) throw conflict("This asset tag is in use", { reason: "work_asset_tag_taken" });
    }
    if (input.assignedToId !== undefined) {
      const a = blank(input.assignedToId) ?? null;
      if (a) await requireEligible(tx, organizationId, chain, a, "operations.read").catch(async () => requireEligible(tx, organizationId, chain, a, "projects.read"));
      data.assignedToId = a;
      if (input.status === undefined) data.status = a ? "IN_USE" : before.status === "IN_USE" ? "AVAILABLE" : before.status;
    }
    if (input.archived !== undefined) data.archivedAt = input.archived ? (before.archivedAt ?? new Date()) : null;
    const a = await tx.opsAsset.update({ where: { id }, data });
    await audit(tx, ctx, organizationId, "ops_asset.updated", "ops_asset", id, input, { status: before.status, assignedToId: before.assignedToId });
    if (a.assignedToId && a.assignedToId !== before.assignedToId && a.assignedToId !== ctx.actor.id) {
      await notifyUsers(tx, organizationId, [a.assignedToId], "work.assetAssigned", { companyId, title: a.name, href: "/operations/assets" });
    }
    return a;
  });
}

// ─── Incidents ───

export const incidentInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: optText(10_000),
  severity: z.enum(SEVERITIES).default("SEV3"),
  ownerId: optUuid,
  projectId: optUuid,
  occurredAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)).optional(),
});
export const updateIncidentInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: optText(10_000),
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  ownerId: optUuid,
  postmortem: optText(50_000),
});

const toInstant = (v?: string) => {
  if (!v) return new Date();
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v.length === 16 ? `${v}:00Z` : v);
  if (Number.isNaN(d.getTime())) throw invalid("Invalid date");
  if (d.getTime() > Date.now() + 3_600_000) throw invalid("The incident can't be in the future", { reason: "work_incident_future" });
  return d;
};

export async function listIncidents(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, string | string[] | undefined>) {
  await authorize(ctx, organizationId, companyId, "operations.read");
  const q = param(raw, "q")?.slice(0, 200);
  const status = param(raw, "status");
  const severity = oneOf(SEVERITIES, param(raw, "severity"));
  const page = pageParam(raw);
  const where: Prisma.OpsIncidentWhereInput = { organizationId, companyId };
  if (status === "open") where.status = { in: ["OPEN", "INVESTIGATING", "MITIGATED"] };
  else if (oneOf(INCIDENT_STATUSES, status)) where.status = status as OpsIncidentStatus;
  if (severity) where.severity = severity as OpsIncidentSeverity;
  if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }];
  const [total, rows] = await Promise.all([
    db().opsIncident.count({ where }),
    db().opsIncident.findMany({ where, orderBy: [{ occurredAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { project: { select: { id: true, name: true } } } }),
  ]);
  const names = await userNames(db(), rows.map((r) => r.ownerId));
  return { data: rows.map((r) => ({ ...r, ownerName: r.ownerId ? (names.get(r.ownerId) ?? null) : null })), total, page, pageSize: PAGE_SIZE };
}

export async function getIncident(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "operations.read");
  const i = await findIn(() => db().opsIncident.findFirst({ where: { id, organizationId, companyId }, include: { project: { select: { id: true, name: true } } } }), "Incident", id);
  const names = await userNames(db(), [i.ownerId, i.createdById]);
  return { ...i, ownerName: i.ownerId ? (names.get(i.ownerId) ?? null) : null, createdByName: names.get(i.createdById) ?? null };
}

export async function createIncident(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof incidentInput>) {
  const input = incidentInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "operations.manage", tx);
    const ownerId = blank(input.ownerId) ?? null;
    if (ownerId) await requireEligible(tx, organizationId, chain, ownerId, "operations.read");
    const projectId = blank(input.projectId) ?? null;
    if (projectId && !(await tx.project.findFirst({ where: { id: projectId, organizationId, companyId }, select: { id: true } }))) throw notFound("Project");
    const i = await tx.opsIncident.create({
      data: { organizationId, companyId, title: input.title, description: blank(input.description) ?? null, severity: input.severity, ownerId, projectId, occurredAt: toInstant(input.occurredAt), createdById: actorId(ctx, organizationId) },
    });
    await audit(tx, ctx, organizationId, "ops_incident.created", "ops_incident", i.id, { title: i.title, severity: i.severity });
    const recipients = input.severity === "SEV1" || input.severity === "SEV2" ? await usersWithPermission(tx, organizationId, companyId, "operations.manage") : [];
    await notifyUsers(tx, organizationId, [...recipients, ownerId].filter((u) => u && u !== ctx.actor.id), "work.incident", { companyId, title: `${i.severity} · ${i.title}`, href: `/operations/incidents/${i.id}` });
    return i;
  });
}

export async function updateIncident(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateIncidentInput>) {
  const input = updateIncidentInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "operations.manage", tx);
    const before = await findIn(() => tx.opsIncident.findFirst({ where: { id, organizationId, companyId } }), "Incident", id);
    const ownerId = input.ownerId === undefined ? undefined : (blank(input.ownerId) ?? null);
    if (ownerId) await requireEligible(tx, organizationId, chain, ownerId, "operations.read");
    const resolved = input.status === "RESOLVED" || input.status === "CLOSED";
    const i = await tx.opsIncident.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: blank(input.description) ?? null } : {}),
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
        ...(input.status !== undefined ? { status: input.status, resolvedAt: resolved ? (before.resolvedAt ?? new Date()) : null } : {}),
        ...(ownerId !== undefined ? { ownerId } : {}),
        ...(input.postmortem !== undefined ? { postmortem: blank(input.postmortem) ?? null } : {}),
      },
    });
    await audit(tx, ctx, organizationId, "ops_incident.updated", "ops_incident", id, input, { status: before.status, severity: before.severity });
    if (ownerId && ownerId !== before.ownerId && ownerId !== ctx.actor.id) await notifyUsers(tx, organizationId, [ownerId], "work.incident", { companyId, title: `${i.severity} · ${i.title}`, href: `/operations/incidents/${id}` });
    return i;
  });
}

// ─── Vendors (CRM accounts of type VENDOR, read-only) ───

export async function listVendors(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, string | string[] | undefined>) {
  await authorize(ctx, organizationId, companyId, "operations.read");
  const q = param(raw, "q")?.slice(0, 200);
  const page = pageParam(raw);
  const where: Prisma.AccountWhereInput = { organizationId, companyId, type: "VENDOR", archivedAt: null };
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q, mode: "insensitive" } }, { industry: { contains: q, mode: "insensitive" } }];
  const [total, data] = await Promise.all([
    db().account.count({ where }),
    db().account.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true, domain: true, website: true, industry: true, email: true, phone: true, countryCode: true, _count: { select: { contacts: true } } },
    }),
  ]);
  return { data, total, page, pageSize: PAGE_SIZE };
}

/** Operations overview numbers. */
export async function operationsOverview(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "operations.read");
  const [processes, checklists, openRuns, assets, openIncidents, sev12] = await Promise.all([
    db().opsProcess.count({ where: { organizationId, companyId, archivedAt: null } }),
    db().opsChecklist.count({ where: { organizationId, companyId, archivedAt: null } }),
    db().opsChecklistRun.count({ where: { organizationId, companyId, completedAt: null } }),
    db().opsAsset.count({ where: { organizationId, companyId, archivedAt: null, status: { not: "RETIRED" } } }),
    db().opsIncident.count({ where: { organizationId, companyId, status: { in: ["OPEN", "INVESTIGATING", "MITIGATED"] } } }),
    db().opsIncident.count({ where: { organizationId, companyId, status: { in: ["OPEN", "INVESTIGATING", "MITIGATED"] }, severity: { in: ["SEV1", "SEV2"] } } }),
  ]);
  const recentIncidents = await db().opsIncident.findMany({ where: { organizationId, companyId }, orderBy: { occurredAt: "desc" }, take: 5, select: { id: true, title: true, severity: true, status: true, occurredAt: true } });
  const dueRuns = await db().opsChecklistRun.findMany({ where: { organizationId, companyId, completedAt: null }, orderBy: { dueOn: "asc" }, take: 5, include: { checklist: { select: { id: true, title: true } } } });
  return { processes, checklists, openRuns, assets, openIncidents, sev12, recentIncidents, dueRuns };
}
