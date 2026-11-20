import "server-only";
import type { RequestContext } from "@/server/core/context";
import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { profileByKey } from "@/server/modules/agents/profiles";
import { businessHealth } from "@/server/modules/bi/health";
import { metricContext, metricValues, pickMetrics } from "@/server/modules/bi/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { todayRange } from "./time";
import { RISK_ORDER, type BriefingData, type BriefingDecision, type BriefingInsight, type BriefingKindKey, type BriefingMetric } from "./types";

const KPI_KEYS = ["finance.revenue", "finance.cash_balance", "crm.new_leads", "crm.won_revenue", "crm.open_pipeline", "finance.expenses", "marketing.leads_generated", "support.backlog", "finance.runway_months", "finance.receivables_overdue"];
const MAX_APPROVALS = 10;

async function safe<T>(label: string, p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    logger.warn({ section: label, err: err instanceof Error ? err.message : String(err) }, "briefing section failed");
    return fallback;
  }
}

/**
 * Compute a briefing for the recipient (ctx = that person): every section reads real records of the company and is
 * included only when the recipient holds the permission for its source. No AI and no estimates.
 */
export async function composeBriefing(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  opts: { kind: BriefingKindKey; from: Date; to: Date; days: number; timezone: string; now?: Date },
): Promise<BriefingData> {
  const now = opts.now ?? new Date();
  const { from, to } = opts;
  const period = { gte: from, lt: to };
  const chain = await companyChain(db(), organizationId, companyId);
  const perms = ["agents.read", "approvals.read", "sales.read", "marketing.read", "communication.read", "projects.read", "support.read", "analytics.read", "audit.read"] as const;
  const held = new Set<string>();
  await Promise.all(perms.map(async (p) => (await can(ctx, p, chain).catch(() => false)) && held.add(p)));
  const has = (p: (typeof perms)[number]) => held.has(p);
  const where = { organizationId, companyId };
  const today = todayRange(now, opts.timezone);
  const company = await db().company.findFirst({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
  const currency = company?.baseCurrency ?? "USD";

  // ── AI workforce ──
  const workforce = has("agents.read")
    ? await safe(
        "workforce",
        (async () => {
          const [finished, inProgress, highlights] = await Promise.all([
            db().agentTask.findMany({ where: { ...where, completedAt: period, status: { in: ["COMPLETED", "FAILED"] } }, select: { status: true, profile: true, aiEmployee: { select: { department: true } } }, take: 5000 }),
            db().agentTask.count({ where: { ...where, status: { in: ["QUEUED", "RUNNING"] } } }),
            db().agentTask.findMany({ where: { ...where, completedAt: period, status: "COMPLETED", depth: 0 }, orderBy: { completedAt: "desc" }, take: 5, select: { id: true, title: true, profile: true, aiEmployee: { select: { name: true, department: true } } } }),
          ]);
          const decided = has("approvals.read")
            ? await db().approval.groupBy({ by: ["status"], where: { ...where, decidedAt: period }, _count: { _all: true } }).catch(() => [])
            : [];
          const auto = has("approvals.read") ? await db().approval.count({ where: { ...where, decidedById: null, status: "EXECUTED", executedAt: period } }) : 0;
          const deptOf = (t: { profile: string; aiEmployee: { department: string } | null }) => t.aiEmployee?.department ?? profileByKey(t.profile)?.department ?? "general";
          const byDept = new Map<string, { completed: number; failed: number }>();
          for (const t of finished) {
            const d = deptOf(t);
            const row = byDept.get(d) ?? { completed: 0, failed: 0 };
            if (t.status === "COMPLETED") row.completed++;
            else row.failed++;
            byDept.set(d, row);
          }
          const decidedCount = (s: string) => decided.find((r) => r.status === s)?._count._all ?? 0;
          return {
            completed: finished.filter((t) => t.status === "COMPLETED").length,
            failed: finished.filter((t) => t.status === "FAILED").length,
            inProgress,
            autoExecuted: auto,
            approvedByPeople: Math.max(0, decidedCount("EXECUTED") + decidedCount("APPROVED") + decidedCount("FAILED") - auto),
            rejected: decidedCount("REJECTED"),
            byDepartment: [...byDept.entries()].map(([department, v]) => ({ department, ...v })).sort((a, b) => b.completed + b.failed - (a.completed + a.failed)),
            highlights: highlights.map((h) => ({ id: h.id, title: h.title.slice(0, 160), department: h.aiEmployee?.department ?? profileByKey(h.profile)?.department ?? null, employee: h.aiEmployee?.name ?? null })),
          };
        })(),
        null,
      )
    : null;

  // ── Work the company sent out / results ──
  const [outreachEmails, campaignEmails, postsPublished, calls, crmMeetingsHeld, teamMeetingsHeld, dealsWon, newLeads] = await Promise.all([
    has("sales.read") ? safe("outreach", db().crmOutreachMessage.count({ where: { ...where, status: "SENT", sentAt: period } }), null) : null,
    has("marketing.read") ? safe("campaign-emails", db().marketingEmailSend.count({ where: { ...where, status: "SENT", createdAt: period } }), null) : null,
    has("marketing.read") ? safe("posts", db().marketingSocialPost.count({ where: { ...where, status: { in: ["PUBLISHED", "PARTIAL"] }, publishedAt: period } }), null) : null,
    has("communication.read") || has("sales.read")
      ? safe("calls", db().event.count({ where: { ...where, occurredAt: period, AND: [{ type: { startsWith: "call." } }, { type: { endsWith: ".completed" } }] } }), null)
      : null,
    has("sales.read") ? safe("crm-meetings", db().crmMeeting.count({ where: { ...where, status: "COMPLETED", endsAt: period } }), null) : null,
    has("communication.read") ? safe("team-meetings", db().commsMeeting.count({ where: { ...where, completedAt: period } }), null) : null,
    has("sales.read")
      ? safe(
          "deals",
          db()
            .crmDeal.aggregate({ where: { ...where, status: "WON", closedAt: period, currency }, _count: { _all: true }, _sum: { amountMinor: true } })
            .then((r) => ({ count: r._count._all, amountMinor: Number(r._sum.amountMinor ?? 0n) })),
          null,
        )
      : null,
    has("sales.read") ? safe("leads", db().lead.count({ where: { ...where, createdAt: period } }), null) : null,
  ]);
  const meetingsHeld = crmMeetingsHeld === null && teamMeetingsHeld === null ? null : (crmMeetingsHeld ?? 0) + (teamMeetingsHeld ?? 0);

  // ── KPIs (bi metrics over the period vs the previous period of equal length) ──
  const kpis: BriefingMetric[] = has("analytics.read")
    ? await safe(
        "kpis",
        (async () => {
          const { scope, metrics } = await metricContext(ctx, organizationId, companyId);
          const values = await metricValues(pickMetrics(metrics, KPI_KEYS), scope, { from, to });
          return values.map((v) => ({ key: v.key, labelKey: v.labelKey, unit: v.unit, value: v.value, previous: v.previous, changePct: v.changePct, trend: v.trend, href: v.href }));
        })(),
        [],
      )
    : [];

  // ── What failed or is blocked ──
  const [failedTasks, failedTaskCount, failedApprovals, failedOutreach, failedCampaign, failedPosts, overdueTasks, slaBreaches] = await Promise.all([
    has("agents.read") ? safe("failed-tasks", db().agentTask.findMany({ where: { ...where, status: "FAILED", completedAt: period }, orderBy: { completedAt: "desc" }, take: 5, select: { id: true, title: true, errorMessage: true } }), []) : [],
    has("agents.read") ? safe("failed-count", db().agentTask.count({ where: { ...where, status: "FAILED", completedAt: period } }), null) : null,
    has("approvals.read") ? safe("failed-approvals", db().approval.count({ where: { ...where, status: "FAILED", executedAt: period } }), null) : null,
    has("sales.read") ? safe("failed-outreach", db().crmOutreachMessage.count({ where: { ...where, status: "FAILED", updatedAt: period } }), null) : null,
    has("marketing.read") ? safe("failed-campaign", db().marketingEmailSend.count({ where: { ...where, status: "FAILED", createdAt: period } }), null) : null,
    has("marketing.read") ? safe("failed-posts", db().marketingSocialPost.count({ where: { ...where, status: { in: ["FAILED", "PARTIAL"] }, updatedAt: period } }), null) : null,
    has("projects.read") ? safe("overdue", db().workTask.count({ where: { ...where, dueDate: { lt: today.from }, status: { notIn: ["DONE", "CANCELLED"] }, archivedAt: null } }), null) : null,
    has("support.read") ? safe("sla", db().supportTicket.count({ where: { ...where, OR: [{ firstResponseBreachedAt: period }, { resolutionBreachedAt: period }] } }), null) : null,
  ]);
  const failedSends = failedOutreach === null && failedCampaign === null ? null : (failedOutreach ?? 0) + (failedCampaign ?? 0);

  // ── Approvals waiting ──
  const approvals = has("approvals.read")
    ? await safe(
        "approvals",
        (async () => {
          const rows = await db().approval.findMany({ where: { ...where, status: "PENDING", expiresAt: { gt: now } }, orderBy: { expiresAt: "asc" }, take: 200, select: { id: true, summary: true, risk: true, autonomy: true, expiresAt: true, requestedByProfile: true } });
          const sorted = [...rows].sort((a, b) => (RISK_ORDER[a.risk] ?? 9) - (RISK_ORDER[b.risk] ?? 9) || a.expiresAt.getTime() - b.expiresAt.getTime());
          return {
            pending: rows.length,
            items: sorted.slice(0, MAX_APPROVALS).map((a, i) => ({
              ref: i + 1,
              id: a.id,
              summary: a.summary.slice(0, 240),
              risk: a.risk,
              expiresAt: a.expiresAt.toISOString(),
              profile: a.requestedByProfile,
              needsMfa: a.risk === "HIGH" || a.risk === "CRITICAL" || a.autonomy === "FOUNDER_ONLY",
            })),
          };
        })(),
        null,
      )
    : null;

  // ── Today's plan ──
  const todayWin = { gte: today.from, lt: today.to };
  const [crmMeetings, teamMeetings, scheduledPosts, campaigns, marketingSteps, salesSteps, schedules, dueTasks, plansRunning] = await Promise.all([
    has("sales.read") ? safe("today-crm", db().crmMeeting.findMany({ where: { ...where, status: "SCHEDULED", startsAt: todayWin }, orderBy: { startsAt: "asc" }, take: 8, select: { title: true, startsAt: true } }), []) : [],
    has("communication.read") ? safe("today-team", db().commsMeeting.findMany({ where: { ...where, status: "SCHEDULED", startsAt: todayWin }, orderBy: { startsAt: "asc" }, take: 8, select: { title: true, startsAt: true } }), []) : [],
    has("marketing.read") ? safe("today-posts", db().marketingSocialPost.count({ where: { ...where, status: "SCHEDULED", scheduledAt: todayWin } }), null) : null,
    has("marketing.read") ? safe("today-campaigns", db().marketingEmailCampaign.findMany({ where: { ...where, status: "SCHEDULED", scheduledAt: todayWin }, orderBy: { scheduledAt: "asc" }, take: 5, select: { name: true, scheduledAt: true } }), []) : [],
    has("marketing.read") ? safe("today-seq", db().marketingSequenceEnrollment.count({ where: { ...where, status: "ACTIVE", nextRunAt: { lt: today.to } } }), null) : null,
    has("sales.read") ? safe("today-cadence", db().crmCadenceEnrollment.count({ where: { ...where, status: "ACTIVE", nextRunAt: { lt: today.to } } }), null) : null,
    has("agents.read")
      ? safe(
          "today-schedules",
          db().aiSchedule.findMany({
            where: { ...where, kind: "RECURRING", enabled: true, aiEmployee: { archivedAt: null, status: "ACTIVE" }, OR: [{ frequency: "DAILY" }, { frequency: "WEEKLY", weekday: today.weekday }] },
            orderBy: { timeOfDay: "asc" },
            take: 8,
            select: { name: true, timeOfDay: true },
          }),
          [],
        )
      : [],
    has("projects.read") ? safe("today-tasks", db().workTask.count({ where: { ...where, dueDate: todayWin, status: { notIn: ["DONE", "CANCELLED"] }, archivedAt: null } }), null) : null,
    has("agents.read") ? safe("plans", db().commandRun.count({ where: { ...where, status: { in: ["PLANNED", "RUNNING", "REVIEWING"] } } }), null) : null,
  ]);
  const meetings = [...crmMeetings.map((m) => ({ title: m.title.slice(0, 160), startsAt: m.startsAt.toISOString(), kind: "sales" as const })), ...teamMeetings.map((m) => ({ title: m.title.slice(0, 160), startsAt: m.startsAt.toISOString(), kind: "team" as const }))]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 10);
  const sequenceSteps = marketingSteps === null && salesSteps === null ? null : (marketingSteps ?? 0) + (salesSteps ?? 0);

  // ── Risks and opportunities (bi health) ──
  const insights = has("analytics.read")
    ? await safe(
        "insights",
        businessHealth(ctx, organizationId, companyId).then((h) => ({
          healthScore: h.score,
          items: h.insights.slice(0, 5).map((i): BriefingInsight => ({ severity: i.severity, kind: i.kind, params: i.params, href: i.href ?? null, department: i.department ?? null })),
        })),
        null,
      )
    : null;

  const data: BriefingData = {
    v: 1,
    kind: opts.kind,
    generatedAt: now.toISOString(),
    currency,
    timezone: opts.timezone,
    period: { from: from.toISOString(), to: to.toISOString(), days: opts.days },
    workforce,
    output: { outreachEmails, campaignEmails, postsPublished, calls, meetingsHeld, dealsWon, newLeads },
    kpis,
    problems: { failedTasks: failedTasks.map((t) => ({ id: t.id, title: t.title.slice(0, 160), error: t.errorMessage?.slice(0, 200) ?? null })), failedTaskCount, failedApprovals, failedSends, failedPosts, overdueTasks, slaBreaches },
    approvals,
    today: {
      meetings,
      scheduledPosts,
      campaigns: campaigns.map((c) => ({ name: c.name.slice(0, 160), scheduledAt: c.scheduledAt!.toISOString() })),
      sequenceSteps,
      aiSchedules: schedules.map((s) => ({ name: s.name.slice(0, 120), timeOfDay: s.timeOfDay })),
      dueTasks,
      plansRunning,
    },
    insights,
    decisions: [],
  };
  data.decisions = recommendDecisions(data, now);
  return data;
}

/** 1–3 recommended decisions, by fixed rules over the computed figures (most urgent first). */
export function recommendDecisions(d: BriefingData, now = new Date()): BriefingDecision[] {
  const out: BriefingDecision[] = [];
  const items = d.approvals?.items ?? [];
  const risky = items.find((a) => a.risk === "HIGH" || a.risk === "CRITICAL");
  if (risky) out.push({ kind: "decide_high_risk", params: { summary: risky.summary, ref: risky.ref }, href: "/approvals" });
  const expiring = items.filter((a) => new Date(a.expiresAt).getTime() - now.getTime() < 24 * 3_600_000).length;
  if (expiring) out.push({ kind: "approvals_expiring", params: { count: expiring }, href: "/approvals" });
  const critical = d.insights?.items.find((i) => i.severity === "critical") ?? d.insights?.items.find((i) => i.severity === "warning");
  if (critical) out.push({ kind: "fix_insight", params: {}, insight: critical, href: critical.href ?? "/analytics/health" });
  const runway = d.kpis.find((k) => k.key === "finance.runway_months");
  if (runway?.value !== null && runway?.value !== undefined && runway.value > 0 && runway.value < 6) out.push({ kind: "runway", params: { months: Math.round(runway.value * 10) / 10 }, href: "/finance" });
  const failed = d.problems.failedTaskCount ?? 0;
  if (failed) out.push({ kind: "retry_failed", params: { count: failed }, href: "/tasks?status=FAILED" });
  const overdue = d.kpis.find((k) => k.key === "finance.receivables_overdue");
  if (overdue?.value) out.push({ kind: "chase_receivables", params: { amountMinor: overdue.value }, href: "/finance/invoices" });
  if (!risky && items.length) out.push({ kind: "review_pending", params: { count: d.approvals!.pending }, href: "/approvals" });
  return out.slice(0, 3);
}
