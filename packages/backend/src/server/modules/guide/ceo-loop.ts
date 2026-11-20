import "server-only";
import { db, transaction, type Prisma } from "@/server/core/db";
import { userContext, type RequestContext } from "@/server/core/context";
import { isAppError } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { agentModel, aiRefusal, getControls, isModuleEnabled, isOrganizationSuspended } from "@/server/core/platform-controls";
import { writeAudit } from "@/server/modules/audit/service";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { profileByKey } from "@/server/modules/agents/profiles";
import { businessHealth } from "@/server/modules/bi/health";
import { isoWeekKey } from "@/server/modules/growth/signals";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { evaluateExecution, planObjective, profileForObjective, type ObjectiveEvaluation } from "@/server/modules/objectives/execution";
import { dayBounds } from "@/server/modules/objectives/overview";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { budgetRefusal, employeeBudget } from "@/server/modules/workforce/budgets";
import { defaultModel } from "@/server/modules/workforce/models";
import { evaluateAutonomy, runAutonomously, type AutonomyRequest } from "@/server/modules/workforce/autonomy-policy";
import type { CeoActionKind } from "@/generated/prisma/enums";
import { startDelegatedRun } from "./command-delegate";

/**
 * The AI CEO operating loop. Once a day per company (after 07:00 company time) the AI CEO:
 *  1. reviews objectives and key results (live metrics), business health and risks, pipeline, cash, marketing and the
 *     AI team's workload — every number from real rows;
 *  2. keeps the week's priorities (persisted, deduped per ISO week, resolved when the condition clears);
 *  3. delegates real command runs for the top priorities to the right department AI employee;
 *  4. follows up on failed or stalled work, asks owners of off-track objectives to replan;
 *  5. escalates decisions to the founder (CeoDecision + notification).
 * Bounded: at most MAX_RUNS_PER_DAY delegated runs/replans per company per day, the CEO's own budget, platform kill
 * switches and the CEO employee's autonomy (suggest-only autonomy turns delegations into founder decisions).
 */

type Scope = { organizationId: string; companyId: string };
export const MAX_RUNS_PER_DAY = 3;
const MAX_PRIORITIES = 5;
const MAX_PRIORITY_ATTEMPTS = 2;
const FOLLOW_UP_AFTER_MS = 3 * 86_400_000;
const STALLED_AFTER_MS = 24 * 3_600_000;
const REPLAN_EVERY_MS = 7 * 86_400_000;
const START_HOUR = 7;
const OPEN_RUN = ["PLANNED", "RUNNING", "REVIEWING"] as const;

const DEPT_PROFILE: Record<string, string> = {
  executive: "bi_analyst",
  sales: "account_executive",
  marketing: "cmo",
  finance: "ai_cfo",
  hr: "people_analyst",
  projects: "ai_project_manager",
  support: "support_lead",
  operations: "operations_assistant",
  ai: "bi_analyst",
};
const pick = (...keys: string[]) => keys.find((k) => profileByKey(k)) ?? "ai_ceo";

interface Candidate {
  sourceKey: string;
  kind: "objective" | "health" | "cash" | "pipeline";
  score: number;
  title: string;
  rationale: string;
  params: Record<string, string | number>;
  href: string | null;
  profile: string;
  objectiveId?: string;
}

interface DecisionInput {
  kind: string;
  sourceKey: string;
  title: string;
  params: Record<string, string | number>;
  href: string | null;
  priorityId?: string | null;
  proposal?: { profile: string; text: string; brief: string; priorityId: string | null } | null;
}

function reasonOf(err: unknown): string {
  if (isAppError(err)) {
    const r = err.details?.reason;
    return typeof r === "string" ? r : err.code;
  }
  return "internal_error";
}

/** Why the loop may not act for this organization right now (platform kill switches, module, AI policy), or null. */
async function platformBlock(organizationId: string, scheduled: boolean): Promise<string | null> {
  const c = await getControls();
  if (c.maintenanceMode) return "maintenance_mode";
  if (c.readOnlyMode) return "read_only_mode";
  if (!c.aiWorkforceEnabled) return "platform_ai_disabled";
  if (c.aiExecutionPaused) return "ai_execution_paused";
  if (scheduled && c.backgroundJobsPaused) return "background_jobs_paused";
  if (await isOrganizationSuspended(organizationId)) return "organization_suspended";
  if (!(await isModuleEnabled(organizationId, "workforce"))) return "module_disabled";
  if (!aiConfigured()) return "ai_not_configured";
  return aiRefusal(organizationId, { profile: "ai_ceo", model: await agentModel(defaultModel()) });
}

/** The company's active AI CEO (oldest), with what budget and autonomy checks need. */
async function activeCeo(scope: Scope) {
  return db().aiEmployee.findFirst({
    where: { ...scope, profileKey: "ai_ceo", archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, status: true, autonomy: true, department: true, model: true, monthlyTokenBudget: true, monthlyCostBudgetCents: true, createdById: true },
  });
}

/** The member whose permissions the loop acts with: who last configured growth, else who hired the AI CEO. */
async function actingUser(companyId: string, ceoCreatedById: string) {
  const s = await db().growthSettings.findUnique({ where: { companyId }, select: { updatedById: true } });
  return s?.updatedById ?? ceoCreatedById;
}

// ───────────────────────── Review ─────────────────────────

const money = (minor: bigint | number, currency: string) => `${(Number(minor) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}`;

/** Everything the CEO looks at, from real rows. Parts the acting member may not read are null. */
async function review(ctx: RequestContext, scope: Scope, currency: string) {
  const chain = await companyChain(db(), scope.organizationId, scope.companyId);
  const [canObjectives, canAnalytics, canSales, canFinance] = await Promise.all([
    can(ctx, "objectives.read", chain),
    can(ctx, "analytics.read", chain),
    can(ctx, "sales.read", chain),
    can(ctx, "finance.read", chain),
  ]);
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      logger.warn({ part: label, companyId: scope.companyId, err: err instanceof Error ? err.message : String(err) }, "ceo review part failed");
      return null;
    }
  };
  const [objectives, health, pipeline, staleDeals, overdue, approvals, workload, failed24h, insights] = await Promise.all([
    canObjectives ? safe("objectives", () => evaluateExecution(ctx, scope)) : null,
    canAnalytics ? safe("health", () => businessHealth(ctx, scope.organizationId, scope.companyId)) : null,
    canSales ? safe("pipeline", () => db().crmDeal.aggregate({ where: { ...scope, status: "OPEN", archivedAt: null }, _count: true, _sum: { amountMinor: true } })) : null,
    canSales ? safe("stale", () => db().crmDeal.count({ where: { ...scope, status: "OPEN", archivedAt: null, staleSince: { not: null } } })) : null,
    canFinance
      ? safe("cash", () =>
          db().invoice.aggregate({
            where: { ...scope, OR: [{ status: "OVERDUE" }, { status: { in: ["SENT", "PARTIALLY_PAID"] }, dueDate: { lt: today } }] },
            _count: true,
            _sum: { totalMinor: true },
          }),
        )
      : null,
    safe("approvals", () => db().approval.count({ where: { ...scope, status: "PENDING", expiresAt: { gt: new Date() } } })),
    safe("workload", () => db().agentTask.groupBy({ by: ["status"], where: { ...scope, status: { in: ["QUEUED", "RUNNING"] } }, _count: true })),
    safe("failed", () => db().agentTask.count({ where: { ...scope, status: "FAILED", completedAt: { gt: new Date(Date.now() - 86_400_000) } } })),
    safe("insights", () => db().growthInsight.count({ where: { ...scope, status: "OPEN" } })),
  ]);
  const marketing = health?.departments.find((d) => d.department === "marketing") ?? null;
  return {
    objectives,
    health,
    snapshot: {
      objectives: objectives?.length ?? null,
      offTrack: objectives ? objectives.filter((o) => o.status === "OFF_TRACK").length : null,
      atRisk: objectives ? objectives.filter((o) => o.status === "AT_RISK").length : null,
      healthScore: health?.score ?? null,
      risks: health ? health.insights.filter((i) => i.severity !== "info").length : null,
      openDeals: pipeline?._count ?? null,
      pipelineMinor: pipeline ? Number(pipeline._sum.amountMinor ?? 0) : null,
      staleDeals,
      overdueInvoices: overdue?._count ?? null,
      overdueMinor: overdue ? Number(overdue._sum.totalMinor ?? 0) : null,
      marketingScore: marketing?.score ?? null,
      pendingApprovals: approvals,
      aiQueued: workload?.find((w) => w.status === "QUEUED")?._count ?? (workload ? 0 : null),
      aiRunning: workload?.find((w) => w.status === "RUNNING")?._count ?? (workload ? 0 : null),
      aiFailed24h: failed24h,
      openInsights: insights,
      currency,
    },
  };
}
type Review = Awaited<ReturnType<typeof review>>;

/** Priority candidates from the review (deterministic, ranked by urgency). */
function candidates(r: Review): Candidate[] {
  const out: Candidate[] = [];
  const s = r.snapshot;
  for (const o of r.objectives ?? []) {
    if (o.status !== "OFF_TRACK" && o.status !== "AT_RISK") continue;
    const worst = o.keyResults.filter((k) => k.status === o.status).sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0))[0];
    const pct = o.progress === null ? 0 : Math.round(o.progress * 100);
    out.push({
      sourceKey: `objective:${o.objectiveId}`,
      kind: "objective",
      score: o.status === "OFF_TRACK" ? 90 : 70,
      title: `Get the objective "${o.title}" back on track`,
      rationale: `The objective is ${o.status === "OFF_TRACK" ? "off track" : "at risk"} at ${pct}% progress${worst ? `; weakest key result: "${worst.title}" at ${worst.progress === null ? "no data" : `${Math.round(worst.progress * 100)}%`}` : ""}${o.targetDate ? `, target date ${o.targetDate.toISOString().slice(0, 10)}` : ""}.`,
      params: { objective: o.title, progress: pct, status: o.status, kr: worst?.title ?? "" },
      href: `/objectives/${o.objectiveId}`,
      profile: o.ownerAiEmployeeId ? "" : profileForObjective(o.keyResults.map((k) => k.metricKey)),
      objectiveId: o.objectiveId,
    });
  }
  for (const i of r.health?.insights ?? []) {
    if (i.kind !== "metric_drop" && i.kind !== "metric_attention" && i.kind !== "overdue_work_tasks" && i.kind !== "overdue_follow_ups") continue;
    const metricKey = typeof i.params.metric === "string" ? i.params.metric : "";
    const def = r.health?.departments.flatMap((d) => d.metrics).find((m) => m.labelKey === metricKey);
    const dept = def?.department ?? (i.kind === "overdue_work_tasks" ? "projects" : i.kind === "overdue_follow_ups" ? "sales" : "executive");
    const metricName = def?.key ?? metricKey;
    out.push({
      sourceKey: `health:${i.kind}:${metricName}`,
      kind: "health",
      score: i.severity === "critical" ? 80 : 50,
      title: i.kind === "metric_drop" ? `Find out why ${metricName} moved ${i.params.change}% and fix it` : i.kind === "metric_attention" ? `Deal with ${metricName} (${i.params.value})` : i.kind === "overdue_work_tasks" ? `Clear ${i.params.count} overdue work tasks` : `Catch up on ${i.params.count} overdue CRM follow-ups`,
      rationale: `Business health flagged a ${i.severity} issue: ${i.kind.replace(/_/g, " ")} (${Object.entries(i.params).map(([k, v]) => `${k}: ${v}`).join(", ")}).`,
      params: { issue: i.kind, ...i.params },
      href: i.href ?? null,
      profile: pick(DEPT_PROFILE[dept] ?? "bi_analyst", "bi_analyst"),
    });
  }
  if (s.overdueInvoices) {
    out.push({
      sourceKey: "cash:overdue",
      kind: "cash",
      score: Math.min(85, 55 + s.overdueInvoices * 3),
      title: `Collect ${s.overdueInvoices} overdue invoices (${money(s.overdueMinor ?? 0, s.currency)})`,
      rationale: `${s.overdueInvoices} invoices are past due for a total of ${money(s.overdueMinor ?? 0, s.currency)}; cash collection protects runway.`,
      params: { count: s.overdueInvoices, amount: (s.overdueMinor ?? 0) / 100, currency: s.currency },
      href: "/finance/receivables",
      profile: pick("ai_cfo", "bi_analyst"),
    });
  }
  if (s.staleDeals) {
    out.push({
      sourceKey: "pipeline:stale",
      kind: "pipeline",
      score: Math.min(75, 45 + s.staleDeals * 2),
      title: `Revive ${s.staleDeals} stalled deals in the pipeline`,
      rationale: `${s.staleDeals} of ${s.openDeals ?? "?"} open deals have not moved stage for longer than the pipeline allows (open pipeline ${money(s.pipelineMinor ?? 0, s.currency)}).`,
      params: { count: s.staleDeals, open: s.openDeals ?? 0 },
      href: "/crm",
      profile: pick("account_executive", "sdr"),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ───────────────────────── Acting ─────────────────────────

async function logAction(scope: Scope, cycleId: string, kind: CeoActionKind, reason: string, extra: { priorityId?: string | null; params?: Record<string, unknown>; profile?: string | null; commandRunId?: string | null; taskId?: string | null; decisionId?: string | null } = {}) {
  await db().ceoAction.create({
    data: {
      ...scope,
      cycleId,
      kind,
      reason,
      priorityId: extra.priorityId ?? null,
      params: (extra.params ?? {}) as Prisma.InputJsonValue,
      profile: extra.profile ?? null,
      commandRunId: extra.commandRunId ?? null,
      taskId: extra.taskId ?? null,
      decisionId: extra.decisionId ?? null,
    },
  });
}

/** Raise (or keep) an open founder decision; notifies the founders the first time. Returns its id and whether it is new. */
async function raiseDecision(ctx: RequestContext, scope: Scope, d: DecisionInput) {
  const existing = await db().ceoDecision.findUnique({ where: { companyId_sourceKey: { companyId: scope.companyId, sourceKey: d.sourceKey } }, select: { id: true, status: true } });
  if (existing) return { id: existing.id, created: false };
  try {
    return await transaction(async (tx) => {
      const row = await tx.ceoDecision.create({
        data: {
          ...scope,
          kind: d.kind,
          sourceKey: d.sourceKey,
          title: d.title.slice(0, 300),
          params: d.params as Prisma.InputJsonValue,
          href: d.href,
          priorityId: d.priorityId ?? null,
          proposal: d.proposal ? (d.proposal as unknown as Prisma.InputJsonValue) : undefined,
        },
        select: { id: true },
      });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId: scope.organizationId, action: "guide.ceo.decision_raised", resourceType: "ceo_decision", resourceId: row.id, newValue: { companyId: scope.companyId, kind: d.kind } });
      await notifyUsers(tx, scope.organizationId, await usersWithPermission(tx, scope.organizationId, scope.companyId, "agents.manage"), "command.ceo_decision", { companyId: scope.companyId, title: d.title.slice(0, 120), href: "/command/ceo" });
      return { id: row.id, created: true };
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      const again = await db().ceoDecision.findUnique({ where: { companyId_sourceKey: { companyId: scope.companyId, sourceKey: d.sourceKey } }, select: { id: true } });
      return { id: again!.id, created: false };
    }
    throw err;
  }
}

async function runsToday(scope: Scope, timeZone: string) {
  const { start } = dayBounds(timeZone);
  const [runs, replans] = await Promise.all([
    db().commandRun.count({ where: { ...scope, origin: "CEO", createdAt: { gte: start } } }),
    db().ceoAction.count({ where: { ...scope, kind: "REPLANNED", createdAt: { gte: start } } }),
  ]);
  return runs + replans;
}

export interface CycleResult {
  status: "COMPLETED" | "SKIPPED" | "FAILED";
  reason?: string;
  cycleId?: string;
  delegated: number;
  followedUp: number;
  escalated: number;
}

/**
 * Run (or re-run, when manual) today's CEO cycle for one company. `scheduled` cycles honour the daily window and
 * background-job pause; a manual run ("Run review now") does not, but stays within the same daily caps.
 */
export async function runCeoCycle(scope: Scope, opts: { trigger: "schedule" | "manual"; actingUserId?: string } = { trigger: "schedule" }): Promise<CycleResult> {
  const company = await db().company.findFirst({ where: { id: scope.companyId, organizationId: scope.organizationId, deletedAt: null }, select: { timezone: true, baseCurrency: true, defaultLocale: true } });
  const none = { delegated: 0, followedUp: 0, escalated: 0 };
  if (!company) return { status: "SKIPPED", reason: "company_missing", ...none };
  const { date: day } = dayBounds(company.timezone);
  const ceo = await activeCeo(scope);
  const userId = opts.actingUserId ?? (ceo ? await actingUser(scope.companyId, ceo.createdById) : null);
  if (!userId) return { status: "SKIPPED", reason: "no_ai_ceo", ...none };

  // Claim today's cycle (a scheduled run happens once a day; a manual one re-runs it unless it is running now).
  const existing = await db().ceoCycle.findUnique({ where: { companyId_day: { companyId: scope.companyId, day } } });
  if (existing && (existing.status === "RUNNING" && Date.now() - existing.startedAt.getTime() < 15 * 60_000)) return { status: "SKIPPED", reason: "already_running", cycleId: existing.id, ...none };
  if (existing && opts.trigger === "schedule") return { status: "SKIPPED", reason: "already_ran", cycleId: existing.id, ...none };
  let cycleId: string;
  try {
    const c = existing
      ? await db().ceoCycle.update({ where: { id: existing.id }, data: { status: "RUNNING", trigger: opts.trigger, actingUserId: userId, startedAt: new Date(), completedAt: null, skippedReason: null } })
      : await db().ceoCycle.create({ data: { ...scope, day, trigger: opts.trigger, actingUserId: userId, ceoEmployeeId: ceo?.id ?? null } });
    cycleId = c.id;
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return { status: "SKIPPED", reason: "already_ran", ...none };
    throw err;
  }
  const skip = async (reason: string): Promise<CycleResult> => {
    await db().ceoCycle.update({ where: { id: cycleId }, data: { status: "SKIPPED", skippedReason: reason, completedAt: new Date() } });
    return { status: "SKIPPED", reason, cycleId, ...none };
  };

  const ctx = userContext(userId, { requestId: `ceo_${scope.companyId}` });
  const blocked = await platformBlock(scope.organizationId, opts.trigger === "schedule");
  if (blocked) return skip(blocked);
  if (!ceo) return skip("no_ai_ceo");
  if (ceo.status !== "ACTIVE") return skip("ceo_paused");
  const chain = await companyChain(db(), scope.organizationId, scope.companyId);
  if (!(await can(ctx, "agents.run", chain))) return skip("acting_user_forbidden");
  const budget = budgetRefusal(ceo.name, await employeeBudget(scope.organizationId, scope.companyId, ceo));
  const controls = await getControls();
  // Company autonomy policy (docs/autonomy.md): internal delegation is the "change data" class of the CEO's department.
  // OFF / SUGGEST (or paused) and an explicit ASK rule turn delegations into founder proposals; "auto" delegates within
  // the policy's limits and is recorded in the auto-approved log. The built-in default keeps the employee-level behaviour.
  const delegationReq: AutonomyRequest = { department: ceo.department || "executive", actionClass: "change_data" };
  const policy = await evaluateAutonomy(ctx, scope.organizationId, scope.companyId, delegationReq).catch(() => null);
  const policyProposes = policy?.decision === "deny" || policy?.reason === "policy_ask";
  const proposeOnly = ceo.autonomy === "READ_ONLY" || ceo.autonomy === "RECOMMEND" || controls.aiAutonomyCeiling === "read_only" || policyProposes;
  const autoDelegate = policy?.decision === "auto" && !proposeOnly;

  try {
    const r = await review(ctx, scope, company.baseCurrency);
    const weekKey = isoWeekKey();
    const counts = { delegated: 0, followedUp: 0, escalated: 0 };
    let used = await runsToday(scope, company.timezone);
    const room = () => MAX_RUNS_PER_DAY - used;

    // 1. Weekly priorities: upsert this week's top candidates, resolve the ones whose condition cleared.
    const top = candidates(r).slice(0, MAX_PRIORITIES);
    const owners = new Map((r.objectives ?? []).map((o) => [o.objectiveId, o.ownerAiEmployeeId]));
    const ownerProfiles = new Map(
      (await db().aiEmployee.findMany({ where: { ...scope, id: { in: [...owners.values()].filter((v): v is string => !!v) } }, select: { id: true, profileKey: true } })).map((e) => [e.id, e.profileKey]),
    );
    for (const c of top) {
      const ownerId = c.objectiveId ? owners.get(c.objectiveId) : null;
      const profile = c.profile || (ownerId ? ownerProfiles.get(ownerId) : undefined) || pick("bi_analyst");
      await db().ceoPriority.upsert({
        where: { companyId_weekKey_sourceKey: { companyId: scope.companyId, weekKey, sourceKey: c.sourceKey } },
        create: { ...scope, weekKey, sourceKey: c.sourceKey, kind: c.kind, score: c.score, title: c.title, rationale: c.rationale, params: c.params, href: c.href, profile, aiEmployeeId: ownerId ?? null, objectiveId: c.objectiveId ?? null },
        update: { score: c.score, title: c.title, rationale: c.rationale, params: c.params, href: c.href, ...(c.objectiveId ? { profile, aiEmployeeId: ownerId ?? null } : {}) },
      });
    }
    // A priority whose source is no longer raised is resolved — but only for the parts the CEO could actually read.
    const readable = new Set<string>([...(r.objectives ? ["objective"] : []), ...(r.health ? ["health"] : []), ...(r.snapshot.overdueInvoices !== null ? ["cash"] : []), ...(r.snapshot.staleDeals !== null ? ["pipeline"] : [])]);
    const raised = new Set(candidates(r).map((c) => c.sourceKey));
    const stillOpen = await db().ceoPriority.findMany({ where: { ...scope, weekKey, status: "ACTIVE" }, orderBy: { score: "desc" } });
    for (const p of stillOpen) {
      if (readable.has(p.kind) && !raised.has(p.sourceKey)) {
        await db().ceoPriority.update({ where: { id: p.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
        await db().ceoDecision.updateMany({ where: { ...scope, priorityId: p.id, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: new Date() } });
      }
    }
    const active = await db().ceoPriority.findMany({ where: { ...scope, weekKey, status: "ACTIVE" }, orderBy: { score: "desc" }, take: MAX_PRIORITIES });

    // 2. Delegate / follow up each active priority (bounded by the daily cap and the CEO's budget).
    const runIds = active.map((p) => p.commandRunId).filter((v): v is string => !!v);
    const runs = runIds.length ? await db().commandRun.findMany({ where: { ...scope, id: { in: runIds } }, select: { id: true, status: true, nextAction: true, createdAt: true, completedAt: true, steps: { select: { status: true, taskId: true } } } }) : [];
    const runOf = new Map(runs.map((x) => [x.id, x]));
    for (const p of active) {
      const run = p.commandRunId ? runOf.get(p.commandRunId) : undefined;
      let action: "delegate" | "follow_up" | "retry" | null = null;
      if (!run) action = "delegate";
      else if ((run.status === "FAILED" || run.status === "CANCELLED") && p.attempts < MAX_PRIORITY_ATTEMPTS) action = "retry";
      else if (run.status === "COMPLETED" && run.completedAt && Date.now() - run.completedAt.getTime() > FOLLOW_UP_AFTER_MS && p.attempts < MAX_PRIORITY_ATTEMPTS + 1) action = "follow_up";
      else if (OPEN_RUN.includes(run.status as (typeof OPEN_RUN)[number]) && Date.now() - run.createdAt.getTime() > STALLED_AFTER_MS) {
        const queued = run.steps.filter((s) => s.taskId).length
          ? await db().agentTask.count({ where: { ...scope, id: { in: run.steps.map((s) => s.taskId).filter((v): v is string => !!v) }, status: "QUEUED" } })
          : 0;
        const blockedSteps = run.steps.filter((s) => s.status === "BLOCKED").length;
        const stepTasks = run.steps.map((s) => s.taskId).filter((v): v is string => !!v);
        const kids = stepTasks.length ? await db().agentTask.findMany({ where: { ...scope, parentTaskId: { in: stepTasks } }, select: { id: true } }) : [];
        const allTasks = [...stepTasks, ...kids.map((k) => k.id)];
        const pendingApprovals = allTasks.length ? await db().approval.count({ where: { ...scope, status: "PENDING", taskId: { in: allTasks } } }) : 0;
        const d = await raiseDecision(ctx, scope, {
          kind: "stalled_work",
          sourceKey: `stalled:${run.id}`,
          title: `Delegated work is stuck: ${p.title}`,
          params: { priority: p.title, hours: Math.round((Date.now() - run.createdAt.getTime()) / 3_600_000), queued, blocked: blockedSteps, approvals: pendingApprovals },
          href: pendingApprovals ? "/approvals" : "/command/ceo",
          priorityId: p.id,
        });
        if (d.created) {
          counts.escalated++;
          await logAction(scope, cycleId, "ESCALATED", "stalled_work", { priorityId: p.id, commandRunId: run.id, decisionId: d.id, params: { queued, blocked: blockedSteps, approvals: pendingApprovals } });
        }
      }
      if (!action) continue;
      const text =
        action === "follow_up" && run?.nextAction
          ? `${p.title} — follow up: ${run.nextAction}`
          : action === "follow_up"
            ? `${p.title} — the issue is still open three days after the last work; take the next step.`
            : p.title;
      const brief = [p.rationale, action === "retry" ? "The previous attempt did not finish; try again and say what blocked it." : "", action === "follow_up" ? "The condition is still present in today's data." : ""].filter(Boolean).join(" ");
      const propose = async () => {
        const d = await raiseDecision(ctx, scope, { kind: "delegation_proposal", sourceKey: `proposal:${p.id}:${p.attempts}`, title: text, params: { priority: p.title, profile: p.profile }, href: p.href, priorityId: p.id, proposal: { profile: p.profile, text, brief, priorityId: p.id } });
        if (d.created) {
          counts.escalated++;
          await logAction(scope, cycleId, "PROPOSED", "autonomy_suggest_only", { priorityId: p.id, profile: p.profile, decisionId: d.id });
        }
      };
      if (proposeOnly) {
        await propose();
        continue;
      }
      if (budget) {
        await logAction(scope, cycleId, "HELD", "ceo_budget", { priorityId: p.id, profile: p.profile, params: { budget: budget.reason } });
        continue;
      }
      if (room() <= 0) {
        await logAction(scope, cycleId, "HELD", "daily_cap", { priorityId: p.id, profile: p.profile, params: { cap: MAX_RUNS_PER_DAY } });
        continue;
      }
      try {
        const delegate = () => startDelegatedRun(ctx, scope, { userId, origin: "CEO", profile: p.profile, priorityId: p.id, objectiveId: p.objectiveId, parentRunId: run?.id ?? null, locale: company.defaultLocale, text, brief });
        let started: Awaited<ReturnType<typeof delegate>>;
        if (autoDelegate) {
          // Auto: reserve the policy's limits, delegate, record (atomic); a limit reached meanwhile → founder proposal.
          const auto = await runAutonomously(ctx, scope.organizationId, scope.companyId, delegationReq, { summary: `AI CEO delegated: ${text}`.slice(0, 1000), aiEmployeeId: ceo.id, source: "ceo" }, async () => {
            const value = await delegate();
            return { value, records: [`command_run:${value.runId}`] };
          });
          if (!auto.actionId || !auto.value) {
            await propose();
            continue;
          }
          started = auto.value;
        } else {
          started = await delegate();
        }
        used++;
        await db().ceoPriority.update({ where: { id: p.id }, data: { commandRunId: started.runId, lastDelegatedAt: new Date(), attempts: run ? { increment: 1 } : undefined } });
        const kind: CeoActionKind = action === "delegate" ? "DELEGATED" : action === "retry" ? "RETRIED" : "FOLLOWED_UP";
        if (action === "delegate") counts.delegated++;
        else counts.followedUp++;
        await logAction(scope, cycleId, kind, action, { priorityId: p.id, profile: p.profile, commandRunId: started.runId, params: { kind: p.kind } });
      } catch (err) {
        const reason = reasonOf(err);
        await logAction(scope, cycleId, "HELD", "delegation_refused", { priorityId: p.id, profile: p.profile, params: { reason } });
        if (reason.includes("budget")) {
          const d = await raiseDecision(ctx, scope, { kind: "budget_exhausted", sourceKey: `budget:${p.profile}:${weekKey}`, title: `AI budget used up for ${p.profile}`, params: { profile: p.profile, reason }, href: "/workforce", priorityId: p.id });
          if (d.created) counts.escalated++;
        }
      }
    }

    // 3. Off-track objectives: the owner replans (newly off track, or still off track a week after the last replan).
    for (const o of (r.objectives ?? []) as ObjectiveEvaluation[]) {
      if (o.status !== "OFF_TRACK") continue;
      const due = o.previousStatus !== "OFF_TRACK" || !o.replannedAt || Date.now() - o.replannedAt.getTime() > REPLAN_EVERY_MS;
      if (!due) continue;
      if (proposeOnly || budget || room() <= 0) {
        const d = await raiseDecision(ctx, scope, { kind: "objective_off_track", sourceKey: `offtrack:${o.objectiveId}:${weekKey}`, title: `Objective off track: ${o.title}`, params: { objective: o.title, progress: o.progress === null ? 0 : Math.round(o.progress * 100) }, href: `/objectives/${o.objectiveId}` });
        if (d.created) {
          counts.escalated++;
          await logAction(scope, cycleId, "ESCALATED", proposeOnly ? "autonomy_suggest_only" : budget ? "ceo_budget" : "daily_cap", { decisionId: d.id, params: { objective: o.title } });
        }
        continue;
      }
      try {
        const reason = `the objective is off track at ${o.progress === null ? 0 : Math.round(o.progress * 100)}% progress (${o.keyResults.filter((k) => k.status === "OFF_TRACK").map((k) => k.title).join(", ") || "key results behind schedule"})`;
        const { taskId } = await planObjective(ctx, scope.organizationId, scope.companyId, o.objectiveId, {}, { replanReason: reason });
        used++;
        await logAction(scope, cycleId, "REPLANNED", "objective_off_track", { taskId, params: { objective: o.title, objectiveId: o.objectiveId } });
      } catch (err) {
        const reason = reasonOf(err);
        if (reason !== "objectives_plan_running") await logAction(scope, cycleId, "HELD", "replan_refused", { params: { objective: o.title, reason } });
      }
    }

    // 4. Decisions only the founder can make.
    const threshold = (await db().growthSettings.findUnique({ where: { companyId: scope.companyId }, select: { decisionThreshold: true } }))?.decisionThreshold ?? 10;
    if (r.snapshot.pendingApprovals !== null && r.snapshot.pendingApprovals >= threshold) {
      const d = await raiseDecision(ctx, scope, { kind: "approvals_backlog", sourceKey: `approvals:${weekKey}`, title: `${r.snapshot.pendingApprovals} approvals are waiting for you`, params: { count: r.snapshot.pendingApprovals }, href: "/approvals" });
      if (d.created) {
        counts.escalated++;
        await logAction(scope, cycleId, "ESCALATED", "approvals_backlog", { decisionId: d.id, params: { count: r.snapshot.pendingApprovals } });
      }
    }
    if (budget) {
      const d = await raiseDecision(ctx, scope, { kind: "budget_exhausted", sourceKey: `budget:ai_ceo:${weekKey}`, title: budget.message, params: { profile: "ai_ceo", reason: budget.reason }, href: `/workforce/${ceo.id}` });
      if (d.created) counts.escalated++;
    }
    for (const p of active) {
      if (!p.profile || profileByKey(p.profile)) continue;
      await logAction(scope, cycleId, "HELD", "profile_unavailable", { priorityId: p.id, profile: p.profile });
    }

    const snapshot = { ...r.snapshot, priorities: active.length };
    await db().ceoCycle.update({ where: { id: cycleId }, data: { status: "COMPLETED", completedAt: new Date(), review: snapshot as Prisma.InputJsonValue, ...counts, ceoEmployeeId: ceo.id } });
    await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId: scope.organizationId, action: "guide.ceo.cycle_completed", resourceType: "ceo_cycle", resourceId: cycleId, newValue: { companyId: scope.companyId, trigger: opts.trigger, ...counts } }));
    return { status: "COMPLETED", cycleId, ...counts };
  } catch (err) {
    logger.warn({ companyId: scope.companyId, err: err instanceof Error ? err.message : String(err) }, "ceo cycle failed");
    await db().ceoCycle.update({ where: { id: cycleId }, data: { status: "FAILED", skippedReason: reasonOf(err).slice(0, 120), completedAt: new Date() } });
    return { status: "FAILED", reason: reasonOf(err), cycleId, ...none };
  }
}

/** Hourly job: every company with an AI CEO whose local time is past the start hour and has no cycle today. */
export async function runCeoCycles(): Promise<number> {
  const c = await getControls();
  if (!c.aiWorkforceEnabled || c.backgroundJobsPaused || c.maintenanceMode) return 0;
  const ceos = await db().aiEmployee.findMany({
    where: { profileKey: "ai_ceo", status: "ACTIVE", archivedAt: null, company: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, companyId: true, company: { select: { timezone: true } } },
    take: 5000,
  });
  const seen = new Set<string>();
  let done = 0;
  for (const e of ceos) {
    if (seen.has(e.companyId)) continue;
    seen.add(e.companyId);
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: safeZone(e.company.timezone), hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    if (hour < START_HOUR) continue;
    try {
      const r = await runCeoCycle({ organizationId: e.organizationId, companyId: e.companyId }, { trigger: "schedule" });
      if (r.status === "COMPLETED") done++;
    } catch (err) {
      logger.warn({ companyId: e.companyId, err: err instanceof Error ? err.message : String(err) }, "ceo cycle crashed");
    }
  }
  return done;
}

function safeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}
