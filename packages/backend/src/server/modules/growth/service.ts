import { z } from "zod";
import { db, transaction, type Prisma, type Tx } from "@/server/core/db";
import { userContext, type RequestContext } from "@/server/core/context";
import { conflict, isAppError, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { pageInput, prismaPage, toPage } from "@/server/core/pagination";
import type { GrowthAutonomy, GrowthSignal } from "@/generated/prisma/enums";
import type { OutboxEvent } from "@/server/modules/events/relay";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask } from "@/server/modules/agents/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { GROWTH_SIGNALS, RESPONSIBLE, SIGNAL_BRIEF, evaluateSignals, isoWeekKey, type FiredSignal } from "./signals";

export const GROWTH_AUTONOMY = ["OBSERVE", "RECOMMEND", "PREPARE", "EXECUTE_WITH_APPROVAL"] as const satisfies readonly GrowthAutonomy[];
export const INSIGHT_SUBJECT = "growth_insight";

export const settingsInput = z.object({
  enabled: z.boolean().optional(),
  autonomy: z.enum(GROWTH_AUTONOMY).optional(),
  decisionThreshold: z.number().int().min(1).max(500).optional(),
});
export const insightStatusInput = z.object({ status: z.enum(["OPEN", "ACTED", "DISMISSED"]) });
export const insightFilters = z.object({
  status: z.enum(["OPEN", "ACTED", "DISMISSED"]).optional().catch(undefined),
  signal: z.enum(GROWTH_SIGNALS).optional().catch(undefined),
});

const DEFAULTS = { enabled: true, autonomy: "RECOMMEND" as GrowthAutonomy, decisionThreshold: 10 };
/** The loop runs at most once per this interval per company (several workers may run the job). */
const MIN_INTERVAL_MS = 55 * 60_000;
const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

const AUTONOMY_ASK: Record<Exclude<GrowthAutonomy, "OBSERVE">, string> = {
  RECOMMEND: "Growth autonomy: recommend. Analyse and give clear, prioritised recommendations with owners; do not propose changes or actions yourself.",
  PREPARE: "Growth autonomy: prepare. Prepare what is needed to act (plans, drafts, task lists) and propose internal changes where useful; every change is filed for approval. Do not send, publish or pay anything.",
  EXECUTE_WITH_APPROVAL: "Growth autonomy: execute with approval. Act on it end to end with the tools you have; every change or external action is filed for a person's approval before it happens, so list the pending approvals at the end.",
};

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "agents.read" | "agents.manage" | "analytics.read", tx?: Tx) {
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), organizationId, companyId), tx);
}

export async function getSettings(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  const s = await db().growthSettings.findUnique({ where: { companyId } });
  return s && s.organizationId === organizationId ? s : { ...DEFAULTS, lastEvaluatedAt: null, updatedById: null, id: null };
}

export async function updateSettings(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof settingsInput>) {
  const input = settingsInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    const before = await tx.growthSettings.findUnique({ where: { companyId } });
    const s = await tx.growthSettings.upsert({
      where: { companyId },
      create: { organizationId, companyId, ...DEFAULTS, ...input, updatedById: ctx.actor.id ?? null },
      update: { ...input, updatedById: ctx.actor.id ?? null },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "growth.settings_updated",
      resourceType: "growth_settings",
      resourceId: s.id,
      oldValue: before ? { enabled: before.enabled, autonomy: before.autonomy, decisionThreshold: before.decisionThreshold } : undefined,
      newValue: { companyId, enabled: s.enabled, autonomy: s.autonomy, decisionThreshold: s.decisionThreshold },
    });
    return s;
  });
}

const insightInclude = { company: false } satisfies Prisma.GrowthInsightInclude;

export async function listInsights(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, unknown> = {}) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  await authorize(ctx, organizationId, companyId, "analytics.read");
  const f = insightFilters.parse(raw);
  const page = pageInput.parse({ limit: raw.limit ?? 20, cursor: raw.cursor });
  const rows = await db().growthInsight.findMany({
    where: { organizationId, companyId, ...(f.status ? { status: f.status } : {}), ...(f.signal ? { signal: f.signal } : {}) },
    orderBy: { id: "desc" },
    include: insightInclude,
    ...prismaPage(page),
  });
  const [tasks, employees] = await Promise.all([
    db().agentTask.findMany({ where: { id: { in: rows.map((r) => r.taskId).filter((x): x is string => !!x) }, companyId }, select: { id: true, status: true, title: true } }),
    db().aiEmployee.findMany({ where: { id: { in: rows.map((r) => r.aiEmployeeId).filter((x): x is string => !!x) }, companyId }, select: { id: true, name: true, initials: true } }),
  ]);
  const t = new Map(tasks.map((x) => [x.id, x]));
  const e = new Map(employees.map((x) => [x.id, x]));
  return toPage(
    rows.map((r) => ({ ...r, task: r.taskId ? (t.get(r.taskId) ?? null) : null, aiEmployee: r.aiEmployeeId ? (e.get(r.aiEmployeeId) ?? null) : null })),
    page,
  );
}

export async function setInsightStatus(ctx: RequestContext, organizationId: string, companyId: string, insightId: string, raw: z.input<typeof insightStatusInput>) {
  const { status } = insightStatusInput.parse(raw);
  if (!isUuid(insightId)) throw notFound("Insight");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    const before = await tx.growthInsight.findFirst({ where: { id: insightId, organizationId, companyId }, select: { id: true, status: true } });
    if (!before) throw notFound("Insight");
    if (before.status === status) throw conflict(`Already ${status.toLowerCase()}`, { reason: "growth_insight_status_unchanged" });
    const now = new Date();
    const i = await tx.growthInsight.update({
      where: { id: insightId },
      data: { status, decidedById: ctx.actor.id ?? null, actedAt: status === "ACTED" ? now : null, dismissedAt: status === "DISMISSED" ? now : null },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "growth.insight_status", resourceType: "growth_insight", resourceId: i.id, oldValue: { status: before.status }, newValue: { companyId, status } });
    return i;
  });
}

/** The responsible AI employee for a signal: first active one with a preferred role, else the AI CEO. */
async function responsibleEmployee(organizationId: string, companyId: string, signal: GrowthSignal) {
  for (const profileKey of [...RESPONSIBLE[signal], "ai_ceo"]) {
    const e = await db().aiEmployee.findFirst({ where: { organizationId, companyId, profileKey, status: "ACTIVE", archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
    if (e) return e;
  }
  return null;
}

const evidenceText = (ev: Record<string, unknown>) =>
  Object.entries(ev)
    .map(([k, v]) => `- ${k}: ${v === null ? "unavailable" : String(v)}`)
    .join("\n");

/** Assign the insight's AI task (subject growth_insight:<id>); records why when it cannot. */
async function assign(ctx: RequestContext, organizationId: string, companyId: string, insight: { id: string; signal: GrowthSignal; evidence: unknown }, autonomy: Exclude<GrowthAutonomy, "OBSERVE">) {
  const employee = await responsibleEmployee(organizationId, companyId, insight.signal);
  if (!employee) {
    await db().growthInsight.update({ where: { id: insight.id }, data: { note: "no_ai_employee" } });
    return null;
  }
  try {
    const task = await createTask(ctx, organizationId, companyId, {
      aiEmployeeId: employee.id,
      title: `Growth: ${insight.signal.toLowerCase().replace(/_/g, " ")}`,
      instructions: [
        `The Realy growth engine detected a signal from the company's own data: ${insight.signal}.`,
        SIGNAL_BRIEF[insight.signal],
        `Evidence computed by Realy (money in minor units; verify details with your tools):\n${evidenceText(insight.evidence as Record<string, unknown>)}`,
        AUTONOMY_ASK[autonomy],
        "End with the three most important next steps, each with an owner, and file a short status report with report_to_manager.",
      ].join("\n\n"),
      subject: { type: INSIGHT_SUBJECT, id: insight.id },
    });
    await db().growthInsight.update({ where: { id: insight.id }, data: { taskId: task.id, aiEmployeeId: employee.id, note: null } });
    return task;
  } catch (err) {
    const reason = isAppError(err) ? ((err.details as { reason?: string } | undefined)?.reason ?? err.code) : "failed";
    await db().growthInsight.update({ where: { id: insight.id }, data: { aiEmployeeId: employee.id, note: String(reason).slice(0, 120) } });
    if (!isAppError(err)) logger.warn({ insightId: insight.id, err: err instanceof Error ? err.message : String(err) }, "growth task failed");
    return null;
  }
}

/**
 * Evaluate one company: fire signals, create insights (one per signal per ISO week), and — unless observing —
 * assign AI work to the responsible AI employee. `ctx` is the member the loop acts for.
 */
export async function evaluateCompany(ctx: RequestContext, organizationId: string, companyId: string, opts: { force?: boolean } = {}) {
  const company = await db().company.findFirst({ where: { id: companyId, organizationId, deletedAt: null }, select: { baseCurrency: true } });
  if (!company) throw notFound("Company");
  const stored = await db().growthSettings.findUnique({ where: { companyId } });
  const settings = { ...DEFAULTS, ...(stored ?? {}) };
  if (!opts.force && stored?.lastEvaluatedAt && Date.now() - stored.lastEvaluatedAt.getTime() < MIN_INTERVAL_MS) return { fired: 0, created: 0, skipped: true };
  await db().growthSettings.upsert({
    where: { companyId },
    create: { organizationId, companyId, ...DEFAULTS, lastEvaluatedAt: new Date(), updatedById: stored?.updatedById ?? null },
    update: { lastEvaluatedAt: new Date() },
  });
  const fired = await evaluateSignals({ organizationId, companyId, currency: company.baseCurrency }, { decisionThreshold: settings.decisionThreshold });
  const weekKey = isoWeekKey();
  let created = 0;
  for (const f of fired) {
    const insight = await createInsight(ctx, organizationId, companyId, f, weekKey, settings.autonomy);
    if (!insight) continue;
    created++;
    if (settings.autonomy !== "OBSERVE") await assign(ctx, organizationId, companyId, insight, settings.autonomy);
    else await db().growthInsight.update({ where: { id: insight.id }, data: { note: "observe" } });
  }
  return { fired: fired.length, created, skipped: false };
}

async function createInsight(ctx: RequestContext, organizationId: string, companyId: string, f: FiredSignal, weekKey: string, autonomy: GrowthAutonomy) {
  try {
    return await transaction(async (tx) => {
      const i = await tx.growthInsight.create({ data: { organizationId, companyId, signal: f.signal, severity: f.severity, evidence: f.evidence as Prisma.InputJsonValue, weekKey, autonomy } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "growth.insight_created", resourceType: "growth_insight", resourceId: i.id, newValue: { companyId, signal: i.signal, severity: i.severity, weekKey } });
      if (f.severity === "CRITICAL") {
        await notifyUsers(tx, organizationId, await usersWithPermission(tx, organizationId, companyId, "agents.manage"), "growth.insight", { companyId, title: f.signal.toLowerCase().replace(/_/g, " "), href: "/intelligence/growth" });
      }
      return i;
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return null; // already fired this week
    throw err;
  }
}

/** "Run now" from the Growth page (agents.manage); ignores the hourly interval. */
export async function runNow(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "agents.manage");
  return evaluateCompany(ctx, organizationId, companyId, { force: true });
}

/** Assign AI work for an insight that has none (observed, or the earlier attempt failed). */
export async function actOnInsight(ctx: RequestContext, organizationId: string, companyId: string, insightId: string) {
  await authorize(ctx, organizationId, companyId, "agents.manage");
  if (!isUuid(insightId)) throw notFound("Insight");
  const i = await db().growthInsight.findFirst({ where: { id: insightId, organizationId, companyId } });
  if (!i) throw notFound("Insight");
  if (i.status !== "OPEN") throw conflict("Only open insights can be acted on", { reason: "growth_insight_not_open" });
  if (i.taskId) {
    const t = await db().agentTask.findFirst({ where: { id: i.taskId, companyId }, select: { status: true } });
    if (t && t.status !== "FAILED" && t.status !== "CANCELLED") throw conflict("AI work is already assigned", { reason: "growth_insight_already_assigned" });
  }
  const s = await db().growthSettings.findUnique({ where: { companyId } });
  const level = s && s.autonomy !== "OBSERVE" ? s.autonomy : "RECOMMEND";
  const task = await assign(ctx, organizationId, companyId, i, level);
  if (!task) {
    const fresh = await db().growthInsight.findUnique({ where: { id: i.id }, select: { note: true } });
    throw conflict("No AI task could be assigned", { reason: fresh?.note === "no_ai_employee" ? "growth_no_ai_employee" : "growth_assign_failed", note: fresh?.note });
  }
  await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "growth.insight_assigned", resourceType: "growth_insight", resourceId: i.id, newValue: { companyId, taskId: task.id } }));
  return task;
}

/** Hourly job: every company with an active AI CEO (settings enabled), acting as the member who configured it. */
export async function runGrowthEngine(): Promise<number> {
  const ceos = await db().aiEmployee.findMany({
    where: { profileKey: "ai_ceo", status: "ACTIVE", archivedAt: null, company: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, companyId: true, createdById: true },
    take: 5000,
  });
  const seen = new Set<string>();
  let created = 0;
  for (const c of ceos) {
    if (seen.has(c.companyId)) continue;
    seen.add(c.companyId);
    const s = await db().growthSettings.findUnique({ where: { companyId: c.companyId }, select: { enabled: true, updatedById: true } });
    if (s && !s.enabled) continue;
    const ctx = userContext(s?.updatedById ?? c.createdById, { requestId: `growth_${c.companyId}` });
    try {
      created += (await evaluateCompany(ctx, c.organizationId, c.companyId)).created;
    } catch (err) {
      logger.warn({ companyId: c.companyId, err: err instanceof Error ? err.message : String(err) }, "growth evaluation failed");
    }
  }
  return created;
}

/** agent.task.completed for an insight's task → the insight is marked acted on. */
export async function handleInsightTaskCompleted(event: OutboxEvent): Promise<void> {
  if (event.type !== "agent.task.completed" || !event.companyId) return;
  const data = ((event.payload ?? {}) as { data?: { subjectType?: string; subjectId?: string } }).data ?? {};
  if (data.subjectType !== INSIGHT_SUBJECT || !data.subjectId || !isUuid(data.subjectId)) return;
  await db().growthInsight.updateMany({ where: { id: data.subjectId, companyId: event.companyId, status: "OPEN", taskId: event.aggregateId }, data: { status: "ACTED", actedAt: new Date() } });
}
