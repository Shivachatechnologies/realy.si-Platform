import type { RequestContext } from "@/server/core/context";
import { db } from "@/server/core/db";
import type { MetricScope } from "@/server/core/metrics";
import { can } from "@/server/modules/rbac/service";
import type { ScopeChain } from "@/server/modules/rbac/scope";
import type { Issue } from "@/server/modules/bi/issues";
import type { MetricValue } from "@/server/modules/bi/service";

/**
 * The structured daily briefing card, computed deterministically from the company's data (no AI): business
 * performance, important events and AI work of the last 24 h, revenue / sales / marketing updates, risks, blockers,
 * decisions needed and priorities for today. Stored on AiBriefing.sections next to the AI's narrative.
 */
export interface CardMetric {
  key: string;
  labelKey: string;
  unit: MetricValue["unit"];
  value: number | null;
  previous: number | null;
  changePct: number | null;
  trend: -1 | 0 | 1;
  href: string | null;
}
export interface BriefingSections {
  generatedAt: string;
  currency: string;
  performance: CardMetric[];
  events: { total: number; byType: { type: string; count: number }[]; latest: { type: string; at: string; entityType: string; entityId: string }[] } | null;
  aiWork: { completed: number; inProgress: number; failed: number; recent: { id: string; title: string; status: string }[] } | null;
  updates: { revenue: CardMetric[]; sales: CardMetric[]; marketing: CardMetric[] };
  risks: Issue[];
  blockers: { overdueTasks: number | null; overdueMilestones: number | null; failedRuns: number | null; slaBreaches: number | null };
  decisions: { pending: number; approvals: { id: string; summary: string; risk: string; expiresAt: string }[]; growth: { id: string; signal: string }[] } | null;
  priorities: { kind: "decide_approvals" | "critical_issue" | "due_today" | "overdue_tasks" | "failed_ai" | "growth_insight"; params: Record<string, string | number>; href: string }[];
}

const PERFORMANCE = ["finance.revenue", "finance.expenses", "finance.net_profit", "finance.cash_balance", "crm.new_leads", "crm.won_revenue", "support.backlog", "work.tasks_completed"];
const REVENUE = ["finance.revenue", "finance.mrr", "finance.receivables_overdue", "finance.runway_months"];
const SALES = ["crm.new_leads", "crm.open_pipeline", "crm.win_rate", "crm.won_revenue"];
const MARKETING = ["marketing.leads_generated", "marketing.spend", "marketing.campaign_roi", "marketing.posts_published"];

const pick = (values: MetricValue[], keys: string[]): CardMetric[] =>
  keys.flatMap((k) => {
    const v = values.find((x) => x.key === k);
    return v ? [{ key: v.key, labelKey: v.labelKey, unit: v.unit, value: v.value, previous: v.previous, changePct: v.changePct, trend: v.trend, href: v.href }] : [];
  });

export async function computeBriefingSections(ctx: RequestContext, chain: ScopeChain, scope: MetricScope, values: MetricValue[], issues: Issue[]): Promise<BriefingSections> {
  const { organizationId, companyId } = scope;
  const allowed = async (p: string) => {
    try {
      return await can(ctx, p, chain);
    } catch {
      return false;
    }
  };
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const [canAudit, canAgents, canProjects, canApprovals, canSupport, canObjectives] = await Promise.all(["audit.read", "agents.read", "projects.read", "approvals.read", "support.read", "objectives.read"].map(allowed));

  const [eventsByType, latestEvents, aiCounts, recentAi, overdueTasks, dueToday, overdueMilestones, slaBreaches, approvals, pending, growth] = await Promise.all([
    canAudit ? db().event.groupBy({ by: ["type"], where: { organizationId, companyId, occurredAt: { gte: dayAgo } }, _count: { _all: true } }) : null,
    canAudit ? db().event.findMany({ where: { organizationId, companyId, occurredAt: { gte: dayAgo }, NOT: { type: { startsWith: "schedule." } } }, orderBy: { occurredAt: "desc" }, take: 8, select: { type: true, occurredAt: true, aggregateType: true, aggregateId: true } }) : null,
    canAgents ? db().agentTask.groupBy({ by: ["status"], where: { organizationId, companyId, OR: [{ completedAt: { gte: dayAgo } }, { status: { in: ["QUEUED", "RUNNING"] } }] }, _count: { _all: true } }) : null,
    canAgents ? db().agentTask.findMany({ where: { organizationId, companyId, OR: [{ completedAt: { gte: dayAgo } }, { status: { in: ["QUEUED", "RUNNING"] } }] }, orderBy: { id: "desc" }, take: 6, select: { id: true, title: true, status: true } }) : null,
    canProjects ? db().workTask.count({ where: { organizationId, companyId, dueDate: { lt: today }, status: { notIn: ["DONE", "CANCELLED"] }, archivedAt: null } }) : null,
    canProjects ? db().workTask.count({ where: { organizationId, companyId, dueDate: { gte: today, lt: tomorrow }, status: { notIn: ["DONE", "CANCELLED"] }, archivedAt: null } }) : null,
    canObjectives ? db().milestone.count({ where: { organizationId, companyId, completedAt: null, dueDate: { lt: today } } }) : null,
    canSupport ? db().supportTicket.count({ where: { organizationId, companyId, OR: [{ firstResponseBreachedAt: { gte: dayAgo } }, { resolutionBreachedAt: { gte: dayAgo } }] } }) : null,
    canApprovals ? db().approval.findMany({ where: { organizationId, companyId, status: "PENDING", expiresAt: { gt: now } }, orderBy: { expiresAt: "asc" }, take: 6, select: { id: true, summary: true, risk: true, expiresAt: true } }) : null,
    canApprovals ? db().approval.count({ where: { organizationId, companyId, status: "PENDING", expiresAt: { gt: now } } }) : null,
    canAgents ? db().growthInsight.findMany({ where: { organizationId, companyId, status: "OPEN", severity: { in: ["WARNING", "CRITICAL"] } }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, signal: true } }) : null,
  ]);
  const count = (s: string) => aiCounts?.filter((r) => r.status === s).reduce((a, r) => a + r._count._all, 0) ?? 0;
  const failedRuns = aiCounts ? count("FAILED") : null;

  const priorities: BriefingSections["priorities"] = [];
  if (pending) priorities.push({ kind: "decide_approvals", params: { count: pending }, href: "/approvals" });
  for (const i of issues.filter((x) => x.severity === "critical").slice(0, 2)) priorities.push({ kind: "critical_issue", params: { kind: i.kind, ...i.params }, href: i.href ?? "/intelligence" });
  for (const g of growth ?? []) priorities.push({ kind: "growth_insight", params: { signal: g.signal }, href: "/intelligence/growth" });
  if (dueToday) priorities.push({ kind: "due_today", params: { count: dueToday }, href: "/projects/my-tasks" });
  if (overdueTasks) priorities.push({ kind: "overdue_tasks", params: { count: overdueTasks }, href: "/projects" });
  if (failedRuns) priorities.push({ kind: "failed_ai", params: { count: failedRuns }, href: "/tasks?status=FAILED" });

  return {
    generatedAt: now.toISOString(),
    currency: scope.currency,
    performance: pick(values, PERFORMANCE),
    events: eventsByType
      ? {
          total: eventsByType.reduce((a, r) => a + r._count._all, 0),
          byType: eventsByType
            .filter((r) => !r.type.startsWith("schedule."))
            .map((r) => ({ type: r.type, count: r._count._all }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8),
          latest: (latestEvents ?? []).map((e) => ({ type: e.type, at: e.occurredAt.toISOString(), entityType: e.aggregateType, entityId: e.aggregateId })),
        }
      : null,
    aiWork: aiCounts ? { completed: count("COMPLETED"), inProgress: count("QUEUED") + count("RUNNING"), failed: count("FAILED"), recent: recentAi ?? [] } : null,
    updates: { revenue: pick(values, REVENUE), sales: pick(values, SALES), marketing: pick(values, MARKETING) },
    risks: issues.slice(0, 8),
    blockers: { overdueTasks, overdueMilestones, failedRuns, slaBreaches },
    decisions: approvals ? { pending: pending ?? 0, approvals: approvals.map((a) => ({ id: a.id, summary: a.summary, risk: a.risk, expiresAt: a.expiresAt.toISOString() })), growth: (growth ?? []).map((g) => ({ id: g.id, signal: g.signal })) } : null,
    priorities: priorities.slice(0, 7),
  };
}

/** English lines for the AI's prompt (so the narrative and the card agree). */
export function sectionsText(s: BriefingSections): string {
  const lines: string[] = [];
  if (s.events) lines.push(`Events in the last 24 h: ${s.events.total}${s.events.byType.length ? ` (${s.events.byType.map((e) => `${e.type} ×${e.count}`).join(", ")})` : ""}`);
  if (s.aiWork) lines.push(`AI work in the last 24 h: ${s.aiWork.completed} completed, ${s.aiWork.inProgress} in progress, ${s.aiWork.failed} failed`);
  const b = s.blockers;
  lines.push(`Blockers: ${[b.overdueTasks !== null ? `${b.overdueTasks} overdue work tasks` : null, b.overdueMilestones !== null ? `${b.overdueMilestones} overdue milestones` : null, b.failedRuns !== null ? `${b.failedRuns} failed AI runs` : null, b.slaBreaches !== null ? `${b.slaBreaches} SLA breaches (24 h)` : null].filter(Boolean).join(", ") || "none visible"}`);
  if (s.decisions) lines.push(`Decisions needed: ${s.decisions.pending} pending approvals${s.decisions.approvals.length ? ` — ${s.decisions.approvals.map((a) => `${a.summary} [${a.risk}]`).join("; ")}` : ""}${s.decisions.growth.length ? `; open growth insights: ${s.decisions.growth.map((g) => g.signal).join(", ")}` : ""}`);
  return lines.join("\n");
}
