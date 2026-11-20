import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { metricByKey } from "./registry";
import { RANGE_KEYS, WIDGET_RANGES } from "./range";

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
const metricKey = z.string().regex(/^[a-z0-9_]+\.[a-z0-9_.]+$/).max(100);

export const dashboardInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  shared: z.boolean().optional(),
});
export const dashboardUpdateInput = dashboardInput.partial();
export const widgetInput = z.object({
  metricKey,
  chartType: z.enum(["NUMBER", "LINE", "BAR"]).default("NUMBER"),
  range: z.enum(WIDGET_RANGES).default("30d"),
  title: z.string().trim().max(120).nullable().optional(),
});
export const widgetUpdateInput = widgetInput.partial();
export const reorderInput = z.object({ widgetIds: z.array(z.string().uuid()).min(1).max(100) });
export const reportInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  metricKeys: z.array(metricKey).min(1).max(30),
  range: z.enum(RANGE_KEYS).default("30d"),
  customFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  customTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  bucketed: z.boolean().optional(),
  shared: z.boolean().optional(),
});
export const reportUpdateInput = reportInput.partial();

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "analytics.read" | "analytics.manage", tx?: Tx) {
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), organizationId, companyId), tx);
}
const visibleTo = (ctx: RequestContext) => ({ OR: [{ shared: true }, { createdById: ctx.actor.id ?? "00000000-0000-0000-0000-000000000000" }] });
function checkMetrics(keys: string[]) {
  const bad = keys.filter((k) => !metricByKey(k));
  if (bad.length) throw invalid(`Unknown metrics: ${bad.join(", ")}`, { reason: "bi_unknown_metric" });
}

// ───────────── Dashboards ─────────────

export async function listDashboards(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "analytics.read");
  return db().biDashboard.findMany({
    where: { organizationId, companyId, ...visibleTo(ctx) },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { widgets: true } } },
  });
}

export async function getDashboard(ctx: RequestContext, organizationId: string, companyId: string, dashboardId: string) {
  await authorize(ctx, organizationId, companyId, "analytics.read");
  if (!isUuid(dashboardId)) throw notFound("Dashboard");
  const d = await db().biDashboard.findFirst({ where: { id: dashboardId, organizationId, companyId, ...visibleTo(ctx) }, include: { widgets: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } } });
  if (!d) throw notFound("Dashboard");
  return d;
}

async function ownDashboard(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, dashboardId: string) {
  if (!isUuid(dashboardId)) throw notFound("Dashboard");
  const d = await tx.biDashboard.findFirst({ where: { id: dashboardId, organizationId, companyId, ...visibleTo(ctx) }, select: { id: true, name: true } });
  if (!d) throw notFound("Dashboard");
  return d;
}

export async function createDashboard(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof dashboardInput>) {
  const input = dashboardInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "analytics.manage", tx);
    const d = await tx.biDashboard.create({ data: { organizationId, companyId, name: input.name, description: input.description ?? null, shared: input.shared ?? false, createdById: ctx.actor.id ?? organizationId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "bi.dashboard.created", resourceType: "bi_dashboard", resourceId: d.id, newValue: { companyId, name: d.name } });
    return d;
  });
}

export async function updateDashboard(ctx: RequestContext, organizationId: string, companyId: string, dashboardId: string, raw: z.input<typeof dashboardUpdateInput>) {
  const input = dashboardUpdateInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "analytics.manage", tx);
    await ownDashboard(tx, ctx, organizationId, companyId, dashboardId);
    const d = await tx.biDashboard.update({
      where: { id: dashboardId },
      data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description || null } : {}), ...(input.shared !== undefined ? { shared: input.shared } : {}) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "bi.dashboard.updated", resourceType: "bi_dashboard", resourceId: d.id, newValue: { companyId, name: d.name, shared: d.shared } });
    return d;
  });
}

export async function deleteDashboard(ctx: RequestContext, organizationId: string, companyId: string, dashboardId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "analytics.manage", tx);
    const d = await ownDashboard(tx, ctx, organizationId, companyId, dashboardId);
    await tx.biDashboard.delete({ where: { id: d.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "bi.dashboard.deleted", resourceType: "bi_dashboard", resourceId: d.id, oldValue: { companyId, name: d.name } });
    return { ok: true };
  });
}

export async function addWidget(ctx: RequestContext, organizationId: string, companyId: string, dashboardId: string, raw: z.input<typeof widgetInput>) {
  const input = widgetInput.parse(raw);
  checkMetrics([input.metricKey]);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "analytics.manage", tx);
    await ownDashboard(tx, ctx, organizationId, companyId, dashboardId);
    const last = await tx.biWidget.aggregate({ where: { dashboardId, companyId }, _max: { position: true } });
    const w = await tx.biWidget.create({ data: { organizationId, companyId, dashboardId, metricKey: input.metricKey, chartType: input.chartType, range: input.range, title: input.title ?? null, position: (last._max.position ?? -1) + 1 } });
    await tx.biDashboard.update({ where: { id: dashboardId }, data: { updatedAt: new Date() } });
    return w;
  });
}

export async function updateWidget(ctx: RequestContext, organizationId: string, companyId: string, dashboardId: string, widgetId: string, raw: z.input<typeof widgetUpdateInput>) {
  const input = widgetUpdateInput.parse(raw);
  if (input.metricKey) checkMetrics([input.metricKey]);
  if (!isUuid(widgetId)) throw notFound("Widget");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "analytics.manage", tx);
    await ownDashboard(tx, ctx, organizationId, companyId, dashboardId);
    const { count } = await tx.biWidget.updateMany({
      where: { id: widgetId, dashboardId, companyId },
      data: {
        ...(input.metricKey ? { metricKey: input.metricKey } : {}),
        ...(input.chartType ? { chartType: input.chartType } : {}),
        ...(input.range ? { range: input.range } : {}),
        ...(input.title !== undefined ? { title: input.title || null } : {}),
      },
    });
    if (!count) throw notFound("Widget");
    return { ok: true };
  });
}

export async function deleteWidget(ctx: RequestContext, organizationId: string, companyId: string, dashboardId: string, widgetId: string) {
  if (!isUuid(widgetId)) throw notFound("Widget");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "analytics.manage", tx);
    await ownDashboard(tx, ctx, organizationId, companyId, dashboardId);
    const { count } = await tx.biWidget.deleteMany({ where: { id: widgetId, dashboardId, companyId } });
    if (!count) throw notFound("Widget");
    return { ok: true };
  });
}

export async function reorderWidgets(ctx: RequestContext, organizationId: string, companyId: string, dashboardId: string, raw: z.input<typeof reorderInput>) {
  const { widgetIds } = reorderInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "analytics.manage", tx);
    await ownDashboard(tx, ctx, organizationId, companyId, dashboardId);
    for (const [position, id] of widgetIds.entries()) await tx.biWidget.updateMany({ where: { id, dashboardId, companyId }, data: { position } });
    return { ok: true };
  });
}

// ───────────── Reports ─────────────

export async function listReports(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "analytics.read");
  return db().biReport.findMany({ where: { organizationId, companyId, ...visibleTo(ctx) }, orderBy: { updatedAt: "desc" } });
}

export async function getReport(ctx: RequestContext, organizationId: string, companyId: string, reportId: string) {
  await authorize(ctx, organizationId, companyId, "analytics.read");
  if (!isUuid(reportId)) throw notFound("Report");
  const r = await db().biReport.findFirst({ where: { id: reportId, organizationId, companyId, ...visibleTo(ctx) } });
  if (!r) throw notFound("Report");
  return r;
}

const dateOrNull = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00Z`) : null);

export async function createReport(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof reportInput>) {
  const input = reportInput.parse(raw);
  checkMetrics(input.metricKeys);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "analytics.manage", tx);
    const r = await tx.biReport.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        description: input.description ?? null,
        metricKeys: [...new Set(input.metricKeys)],
        range: input.range,
        customFrom: input.range === "custom" ? dateOrNull(input.customFrom) : null,
        customTo: input.range === "custom" ? dateOrNull(input.customTo) : null,
        bucketed: input.bucketed ?? false,
        shared: input.shared ?? true,
        createdById: ctx.actor.id ?? organizationId,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "bi.report.created", resourceType: "bi_report", resourceId: r.id, newValue: { companyId, name: r.name } });
    return r;
  });
}

export async function updateReport(ctx: RequestContext, organizationId: string, companyId: string, reportId: string, raw: z.input<typeof reportUpdateInput>) {
  const input = reportUpdateInput.parse(raw);
  if (input.metricKeys) checkMetrics(input.metricKeys);
  if (!isUuid(reportId)) throw notFound("Report");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "analytics.manage", tx);
    const before = await tx.biReport.findFirst({ where: { id: reportId, organizationId, companyId, ...visibleTo(ctx) } });
    if (!before) throw notFound("Report");
    const range = input.range ?? before.range;
    const r = await tx.biReport.update({
      where: { id: reportId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.metricKeys ? { metricKeys: [...new Set(input.metricKeys)] } : {}),
        range,
        customFrom: range === "custom" ? (input.customFrom !== undefined ? dateOrNull(input.customFrom) : before.customFrom) : null,
        customTo: range === "custom" ? (input.customTo !== undefined ? dateOrNull(input.customTo) : before.customTo) : null,
        ...(input.bucketed !== undefined ? { bucketed: input.bucketed } : {}),
        ...(input.shared !== undefined ? { shared: input.shared } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "bi.report.updated", resourceType: "bi_report", resourceId: r.id, newValue: { companyId, name: r.name } });
    return r;
  });
}

export async function deleteReport(ctx: RequestContext, organizationId: string, companyId: string, reportId: string) {
  if (!isUuid(reportId)) throw notFound("Report");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "analytics.manage", tx);
    const r = await tx.biReport.findFirst({ where: { id: reportId, organizationId, companyId, ...visibleTo(ctx) }, select: { id: true, name: true } });
    if (!r) throw notFound("Report");
    await tx.biReport.delete({ where: { id: r.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "bi.report.deleted", resourceType: "bi_report", resourceId: r.id, oldValue: { companyId, name: r.name } });
    return { ok: true };
  });
}
