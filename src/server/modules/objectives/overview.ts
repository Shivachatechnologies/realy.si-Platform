import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { budgetVsActual } from "@/server/modules/finance/transactions";
import { can } from "@/server/modules/rbac/service";
import type { ScopeChain } from "@/server/modules/rbac/scope";
import { goalTree } from "./goals";
import { average, evaluateObjectives, type KrStatus } from "./key-results";

/** Read models for the Command Center and the company operating dashboard (each part gated by its permission). */

const OPEN_TASK = { notIn: ["DONE", "CANCELLED"] as ("DONE" | "CANCELLED")[] };
const NOBODY = "00000000-0000-0000-0000-000000000000";

/** Start and end (exclusive) of "today" in a time zone. */
export function dayBounds(timeZone: string, now = new Date()) {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  const offset = asUtc - Math.floor(now.getTime() / 1000) * 1000;
  const start = new Date(Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!) - offset);
  return { start, end: new Date(start.getTime() + 86_400_000), date: new Date(Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!)) };
}

const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), part: label }, "command center part failed");
    return null;
  }
};

/** Counters for the Command Center; null = the viewer may not read that area. */
export async function commandCounters(ctx: RequestContext, organizationId: string, companyId: string, chain: ScopeChain) {
  const me = ctx.actor.id ?? NOBODY;
  const scoped = { organizationId, companyId };
  const today = dayBounds("UTC").date;
  const gate = async (permission: string, fn: () => Promise<number>) => ((await can(ctx, permission, chain)) ? safe(permission, fn) : null);
  const [objectives, myTasks, aiRunning, aiEmployees, approvals, overdueInvoices] = await Promise.all([
    gate("objectives.read", () => db().objective.count({ where: { ...scoped, status: "ACTIVE" } })),
    gate("projects.read", () => db().workTask.count({ where: { ...scoped, archivedAt: null, assigneeId: me, status: OPEN_TASK } })),
    gate("agents.read", () => db().agentTask.count({ where: { ...scoped, status: { in: ["QUEUED", "RUNNING"] } } })),
    gate("agents.read", () => db().aiEmployee.count({ where: { ...scoped, archivedAt: null, status: "ACTIVE" } })),
    gate("approvals.read", () => db().approval.count({ where: { ...scoped, status: "PENDING", expiresAt: { gt: new Date() } } })),
    gate("finance.read", () => db().invoice.count({ where: { ...scoped, OR: [{ status: "OVERDUE" }, { status: { in: ["SENT", "PARTIALLY_PAID"] }, dueDate: { lt: today } }] } })),
  ]);
  return [
    { key: "objectives", value: objectives, href: "/objectives" },
    { key: "myTasks", value: myTasks, href: "/projects/my-tasks" },
    { key: "aiRunning", value: aiRunning, href: "/tasks" },
    { key: "approvals", value: approvals, href: "/approvals" },
    { key: "overdueInvoices", value: overdueInvoices, href: "/finance/receivables" },
    { key: "aiEmployees", value: aiEmployees, href: "/workforce" },
  ].filter((c) => c.value !== null) as { key: string; value: number; href: string }[];
}

/** The viewer's day: tasks due today, meetings today, follow-ups due (each null when not permitted). */
export async function myToday(ctx: RequestContext, organizationId: string, companyId: string, chain: ScopeChain, timeZone: string) {
  const me = ctx.actor.id ?? NOBODY;
  const scoped = { organizationId, companyId };
  const { start, end, date } = dayBounds(timeZone);
  const [canTasks, canMeetings, canSales] = await Promise.all([can(ctx, "projects.read", chain), can(ctx, "communication.read", chain), can(ctx, "sales.read", chain)]);
  const [tasks, meetings, crmFollowUps, leadFollowUps] = await Promise.all([
    canTasks
      ? safe("tasks", () =>
          db().workTask.findMany({
            where: { ...scoped, archivedAt: null, assigneeId: me, status: OPEN_TASK, dueDate: { lte: date } },
            orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
            take: 8,
            select: { id: true, title: true, dueDate: true, priority: true, project: { select: { name: true } } },
          }),
        )
      : null,
    canMeetings
      ? safe("meetings", () =>
          db().commsMeeting.findMany({
            where: { ...scoped, status: "SCHEDULED", startsAt: { gte: start, lt: end }, OR: [{ organizerId: me }, { attendees: { some: { userId: me } } }] },
            orderBy: { startsAt: "asc" },
            take: 8,
            select: { id: true, title: true, startsAt: true, endsAt: true, location: true },
          }),
        )
      : null,
    canSales
      ? safe("crmFollowUps", () =>
          db().crmFollowUp.findMany({
            where: { ...scoped, assigneeId: me, completedAt: null, dueAt: { lt: end } },
            orderBy: { dueAt: "asc" },
            take: 8,
            select: { id: true, note: true, dueAt: true, deal: { select: { id: true, name: true } }, contactId: true, accountId: true },
          }),
        )
      : null,
    canSales
      ? safe("leadFollowUps", () =>
          db().leadFollowUp.findMany({
            where: { ...scoped, completedAt: null, dueAt: { lt: end }, lead: { ownerId: me } },
            orderBy: { dueAt: "asc" },
            take: 8,
            select: { id: true, note: true, dueAt: true, lead: { select: { id: true, name: true } } },
          }),
        )
      : null,
  ]);
  const followUps =
    crmFollowUps === null && leadFollowUps === null
      ? null
      : [
          ...(crmFollowUps ?? []).map((f) => ({ id: f.id, note: f.note, dueAt: f.dueAt, label: f.deal?.name ?? null, href: f.deal ? `/crm/deals/${f.deal.id}` : f.contactId ? `/crm/contacts/${f.contactId}` : f.accountId ? `/crm/accounts/${f.accountId}` : "/crm/calendar" })),
          ...(leadFollowUps ?? []).map((f) => ({ id: f.id, note: f.note, dueAt: f.dueAt, label: f.lead.name, href: `/crm/${f.lead.id}` })),
        ]
          .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
          .slice(0, 8);
  return { tasks, meetings, followUps, todayStart: start, todayDate: date };
}

/** Active goals with progress (mean of their objectives' progress; objective = mean of key results or milestones). */
export async function goalsProgress(ctx: RequestContext, organizationId: string, companyId: string, chain: ScopeChain) {
  if (!(await can(ctx, "objectives.read", chain))) return null;
  const { goals } = await goalTree(ctx, organizationId, companyId, { status: "ACTIVE" });
  const objectives = goals.flatMap((g) => g.objectives.filter((o) => o.status !== "ABANDONED"));
  const evaluated = await evaluateObjectives(ctx, organizationId, companyId, objectives, chain);
  const progressById = new Map(objectives.map((o, i) => [o.id, o.status === "ACHIEVED" ? 1 : evaluated.objectives[i] ?? null]));
  return goals.slice(0, 6).map((g) => {
    const active = g.objectives.filter((o) => o.status !== "ABANDONED");
    const krs = active.flatMap((o) => o.keyResults.map((k) => evaluated.keyResults.get(k.id)?.status ?? "NO_DATA"));
    return {
      id: g.id,
      title: g.title,
      horizon: g.horizon,
      targetDate: g.targetDate,
      objectives: active.length,
      progress: average(active.map((o) => progressById.get(o.id) ?? null)),
      atRisk: krs.filter((s) => s === "AT_RISK" || s === "OFF_TRACK").length,
      planPending: !g.planAppliedAt && !!g.planTaskId,
    };
  });
}

/** Company operating dashboard: per department headcount, open projects, budget use and key-result status. */
export async function companyOperations(ctx: RequestContext, organizationId: string, companyId: string, chain: ScopeChain) {
  const scoped = { organizationId, companyId };
  const [canHr, canProjects, canFinance, canObjectives] = await Promise.all([can(ctx, "hr.read", chain), can(ctx, "projects.read", chain), can(ctx, "finance.read", chain), can(ctx, "objectives.read", chain)]);
  if (!canHr && !canObjectives) return null;
  const departments = await db().department.findMany({ where: { ...scoped, archivedAt: null }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true } });
  const ids = departments.map((d) => d.id);
  const today = dayBounds("UTC").date;
  const company = await db().company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
  const [headcount, owners, budgets, objectives] = await Promise.all([
    canHr ? db().employee.groupBy({ by: ["departmentId"], where: { ...scoped, departmentId: { in: ids }, status: { in: ["ACTIVE", "ONBOARDING", "ON_LEAVE"] } }, _count: true }) : null,
    canHr && canProjects ? db().employee.findMany({ where: { ...scoped, departmentId: { in: ids }, userId: { not: null }, status: { not: "TERMINATED" } }, select: { userId: true, departmentId: true } }) : null,
    canFinance ? safe("budgets", () => budgetVsActual(ctx, organizationId, companyId, { from: today, to: new Date(today.getTime() + 86_400_000) })) : null,
    canObjectives
      ? db().objective.findMany({
          where: { ...scoped, status: "ACTIVE", departmentId: { not: null } },
          take: 200,
          include: { keyResults: true, milestones: { select: { completedAt: true } } },
        })
      : null,
  ]);
  const ownerDept = new Map((owners ?? []).map((e) => [e.userId!, e.departmentId!]));
  const projects = owners?.length
    ? await db().project.findMany({ where: { ...scoped, archivedAt: null, status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] }, ownerId: { in: [...ownerDept.keys()] } }, select: { ownerId: true, health: true } })
    : [];
  const evaluated = objectives?.length ? await evaluateObjectives(ctx, organizationId, companyId, objectives, chain) : null;
  const rows = departments.map((d) => {
    const deptBudgets = (budgets ?? []).filter((b) => b.departmentId === d.id && b.currency === company.baseCurrency);
    const budgetMinor = deptBudgets.reduce((s, b) => s + b.amountMinor, 0n);
    const actualMinor = deptBudgets.reduce((s, b) => s + b.actualMinor, 0n);
    const deptProjects = projects.filter((p) => p.ownerId && ownerDept.get(p.ownerId) === d.id);
    const deptObjectives = (objectives ?? []).filter((o) => o.departmentId === d.id);
    const statuses: Record<KrStatus, number> = { ACHIEVED: 0, ON_TRACK: 0, AT_RISK: 0, OFF_TRACK: 0, NO_DATA: 0 };
    for (const o of deptObjectives) for (const k of o.keyResults) statuses[evaluated?.keyResults.get(k.id)?.status ?? "NO_DATA"]++;
    return {
      id: d.id,
      name: d.name,
      headcount: headcount ? (headcount.find((h) => h.departmentId === d.id)?._count ?? 0) : null,
      openProjects: canHr && canProjects ? deptProjects.length : null,
      projectsAtRisk: canHr && canProjects ? deptProjects.filter((p) => p.health !== "ON_TRACK").length : null,
      budget: budgets ? (deptBudgets.length ? { budgetMinor, actualMinor, usedPct: budgetMinor > 0n ? Number((actualMinor * 10_000n) / budgetMinor) / 100 : null } : undefined) : null,
      objectives: canObjectives ? deptObjectives.length : null,
      keyResults: canObjectives ? statuses : null,
    };
  });
  const totals = {
    headcount: headcount ? headcount.reduce((s, h) => s + h._count, 0) : null,
    unassignedHeadcount: canHr ? await db().employee.count({ where: { ...scoped, departmentId: null, status: { in: ["ACTIVE", "ONBOARDING", "ON_LEAVE"] } } }) : null,
    openProjects: canProjects ? await db().project.count({ where: { ...scoped, archivedAt: null, status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] } } }) : null,
  };
  return { departments: rows, totals, currency: company.baseCurrency, can: { hr: canHr, projects: canProjects, finance: canFinance, objectives: canObjectives } };
}
