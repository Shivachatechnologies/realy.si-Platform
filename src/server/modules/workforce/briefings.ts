import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { pageInput, prismaPage, toPage } from "@/server/core/pagination";
import type { AiBriefingMode } from "@/generated/prisma/enums";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask } from "@/server/modules/agents/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { criticalIssues, issueText } from "@/server/modules/bi/issues";
import { englishT } from "@/server/modules/bi/labels";
import { isoDay, resolveRange, type RangeKey } from "@/server/modules/bi/range";
import { metricContext, metricValues } from "@/server/modules/bi/service";

export const BRIEFING_MODES = ["DAILY", "WEEKLY", "MONTHLY", "TREND_RISK"] as const satisfies readonly AiBriefingMode[];
export const BRIEFING_PROFILES = ["ai_ceo", "bi_analyst"] as const;
export const briefingInput = z.object({
  mode: z.enum(BRIEFING_MODES),
  profile: z.enum(BRIEFING_PROFILES).optional(),
  aiEmployeeId: z.string().uuid().optional(),
});
export const dailyBriefingInput = z.object({ enabled: z.boolean(), timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("08:00"), aiEmployeeId: z.string().uuid() });

const RANGE: Record<AiBriefingMode, RangeKey> = { DAILY: "7d", WEEKLY: "7d", MONTHLY: "30d", TREND_RISK: "90d" };
const BRIEF: Record<AiBriefingMode, { title: string; ask: string }> = {
  DAILY: {
    title: "Daily briefing",
    ask: "Write today's executive briefing: the three to five things that matter most today (wins, risks, decisions needed), each with the evidence and a concrete next step and owner. Keep it to one page. Delegate follow-up work to AI employees where useful.",
  },
  WEEKLY: {
    title: "Weekly review",
    ask: "Write the weekly business review: performance by department vs the previous week, what went well, what went badly and why, open issues, and priorities for next week.",
  },
  MONTHLY: {
    title: "Monthly report",
    ask: "Write the monthly report: headline results vs the previous 30 days, department-by-department performance, progress on objectives, risks, and recommendations for next month.",
  },
  TREND_RISK: {
    title: "Trend & risk analysis",
    ask: "Analyse trends and risks over the last 90 days: use read_metric_series for the metrics that moved most, identify sustained trends, anomalies and leading indicators of risk, rate each risk (likelihood, impact) and recommend mitigations.",
  },
};

/** Default profile for a mode: trend analysis goes to the BI analyst, briefings to the AI CEO. */
export const defaultProfileFor = (mode: AiBriefingMode) => (mode === "TREND_RISK" ? "bi_analyst" : "ai_ceo");

/**
 * Create a briefing: compute the KPI snapshot and critical issues deterministically, then assign the write-up to the
 * AI CEO (or BI analyst) as an agent task. The issues are stored with the briefing and shown next to the AI output.
 */
export async function generateBriefing(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  raw: z.input<typeof briefingInput> & { scheduled?: boolean; extra?: string },
) {
  const input = briefingInput.parse(raw);
  const { chain, scope, metrics } = await metricContext(ctx, organizationId, companyId);
  const range = resolveRange(RANGE[input.mode]);
  const values = await metricValues(metrics, scope, range);
  const weekly = RANGE[input.mode] === "7d" ? values : undefined;
  const issues = await criticalIssues(ctx, chain, scope, metrics, weekly);

  let profile: string = input.profile ?? defaultProfileFor(input.mode);
  let aiEmployeeId = input.aiEmployeeId;
  if (aiEmployeeId) {
    const e = await db().aiEmployee.findFirst({ where: { id: aiEmployeeId, organizationId, companyId, archivedAt: null }, select: { profileKey: true } });
    if (!e) throw notFound("AI employee");
    if (!(BRIEFING_PROFILES as readonly string[]).includes(e.profileKey)) throw conflict("Briefings are written by the AI CEO or a BI analyst", { reason: "workforce_briefing_wrong_profile" });
    profile = e.profileKey;
  } else {
    aiEmployeeId = (await db().aiEmployee.findFirst({ where: { organizationId, companyId, profileKey: profile, status: "ACTIVE", archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  }

  const period = `${isoDay(range.from)} to ${isoDay(new Date(range.to.getTime() - 1))}`;
  const kpiLines = values.map((v) => `- ${englishT(v.labelKey)} [${v.key}]: ${v.value ?? "unavailable"} (previous ${v.previous ?? "unavailable"}${v.changePct === null ? "" : `, ${v.changePct.toFixed(1)}%`})${v.unit === "money" ? ` (minor units of ${scope.currency})` : ""}`);
  const instructions = [
    BRIEF[input.mode].ask,
    `Period: ${period} (compared with the previous period of equal length).`,
    `KPI snapshot computed by Realy (verify details with your tools):\n${kpiLines.length ? kpiLines.join("\n") : "(no KPIs available)"}`,
    `Critical issues detected automatically:\n${issues.length ? issues.map((i) => `- [${i.severity}] ${issueText(i, englishT)}`).join("\n") : "(none)"}`,
    raw.extra ? `Additional instructions:\n${raw.extra}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8000);

  const task = await createTask(ctx, organizationId, companyId, {
    ...(aiEmployeeId ? { aiEmployeeId } : { profile: profile as never }),
    title: `${BRIEF[input.mode].title} — ${isoDay(new Date())}`,
    instructions,
  });
  const kpis = values.map((v) => ({ key: v.key, labelKey: v.labelKey, unit: v.unit, value: v.value, previous: v.previous, changePct: v.changePct, trend: v.trend }));
  return transaction(async (tx) => {
    const b = await tx.aiBriefing.create({
      data: {
        organizationId,
        companyId,
        mode: input.mode,
        profile,
        taskId: task.id,
        periodStart: range.from,
        periodEnd: range.to,
        kpis,
        issues: issues as unknown as object[],
        scheduled: raw.scheduled ?? false,
        createdById: ctx.actor.id ?? organizationId,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ai_briefing.created", resourceType: "ai_briefing", resourceId: b.id, newValue: { companyId, mode: b.mode, taskId: task.id } });
    return b;
  });
}

export async function listBriefings(ctx: RequestContext, organizationId: string, companyId: string, raw: { mode?: string; profile?: string; limit?: number; cursor?: string } = {}) {
  await requirePermission(ctx, "agents.read", await companyChain(db(), organizationId, companyId));
  const page = pageInput.parse({ limit: raw.limit ?? 20, cursor: raw.cursor });
  const mode = z.enum(BRIEFING_MODES).optional().catch(undefined).parse(raw.mode);
  const profile = z.enum(BRIEFING_PROFILES).optional().catch(undefined).parse(raw.profile);
  const rows = await db().aiBriefing.findMany({ where: { organizationId, companyId, ...(mode ? { mode } : {}), ...(profile ? { profile } : {}) }, orderBy: { id: "desc" }, ...prismaPage(page) });
  const tasks = await db().agentTask.findMany({
    where: { id: { in: rows.map((r) => r.taskId).filter((x): x is string => !!x) }, companyId },
    select: { id: true, status: true, output: true, errorMessage: true, title: true, aiEmployeeId: true },
  });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return toPage(
    rows.map((r) => ({ ...r, task: r.taskId ? (byId.get(r.taskId) ?? null) : null })),
    page,
  );
}

/** The daily briefing schedule (an AI schedule with briefingMode DAILY) of the company, if any. */
export async function dailyBriefingSchedule(organizationId: string, companyId: string) {
  return db().aiSchedule.findFirst({ where: { organizationId, companyId, briefingMode: "DAILY", kind: "RECURRING", aiEmployee: { archivedAt: null } }, orderBy: { createdAt: "asc" } });
}
