import { z } from "zod";
import type { CostBudgetScope, CostCategory } from "@/generated/prisma/enums";
import { db, transaction, type Prisma, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { BUDGET_DEPARTMENTS } from "@/server/modules/workforce/budgets";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";

/**
 * Unified cost ledger (docs: module header in costs.prisma). Every real spend becomes one CostLedgerEntry, written
 * through recordCost() — the agents runtime per model call, the sync job for integration usage and voice calls, and
 * any module that pays a provider (images, video, TTS/STT, telephony, email, external APIs). Budgets at company,
 * department, AI employee (monthly) and task level with a hard stop: callers check checkSpend()/assertSpendAllowed()
 * BEFORE spending and stop with an honest "budget reached" state. Alerts at 50 / 80 / 100 % notify once per period.
 */

const log = logger.child({ component: "costs" });
export const ALERT_THRESHOLDS = [50, 80, 100] as const;
export const COST_CATEGORIES = ["AI_TOKENS", "IMAGE", "VIDEO", "VOICE", "STT", "TTS", "TELEPHONY", "EMAIL", "SMS", "MESSAGING", "EXTERNAL_API", "OTHER"] as const satisfies readonly CostCategory[];
export const BUDGET_SCOPES = ["COMPANY", "DEPARTMENT", "AGENT", "TASK"] as const satisfies readonly CostBudgetScope[];

const utcMonthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const monthKey = (now = new Date()) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
const big = (v: number | bigint) => (typeof v === "bigint" ? v : BigInt(Math.max(0, Math.round(v))));

export interface CostEntry {
  organizationId: string;
  companyId: string;
  category: CostCategory;
  provider: string;
  model?: string | null;
  operation: string;
  department?: string | null;
  aiEmployeeId?: string | null;
  taskId?: string | null;
  /** Idempotency: the same (sourceType, sourceId) is recorded once. */
  sourceType: string;
  sourceId: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  units?: number;
  unit?: string;
  costMicros: number | bigint;
  estimated?: boolean;
  meta?: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * Record one real spend. Never throws (metering must not break the feature that spent); returns whether a new row was
 * written. After writing, budget alerts for the affected scopes are evaluated (best effort).
 */
export async function recordCost(e: CostEntry): Promise<boolean> {
  try {
    const r = await db().costLedgerEntry.createMany({
      skipDuplicates: true,
      data: [
        {
          organizationId: e.organizationId,
          companyId: e.companyId,
          occurredAt: e.occurredAt ?? new Date(),
          category: e.category,
          provider: e.provider.slice(0, 60),
          model: e.model?.slice(0, 80) ?? null,
          operation: e.operation.slice(0, 80),
          department: e.department ?? null,
          aiEmployeeId: e.aiEmployeeId ?? null,
          taskId: e.taskId ?? null,
          sourceType: e.sourceType.slice(0, 60),
          sourceId: e.sourceId.slice(0, 200),
          inputTokens: Math.max(0, Math.round(e.inputTokens ?? 0)),
          outputTokens: Math.max(0, Math.round(e.outputTokens ?? 0)),
          cachedTokens: Math.max(0, Math.round(e.cachedTokens ?? 0)),
          cacheWriteTokens: Math.max(0, Math.round(e.cacheWriteTokens ?? 0)),
          units: Math.max(0, Math.round(e.units ?? 1)),
          unit: e.unit ?? "request",
          costMicros: big(e.costMicros),
          estimated: e.estimated ?? true,
          meta: (e.meta ?? {}) as Prisma.InputJsonValue,
        },
      ],
    });
    if (r.count) await evaluateAlerts({ organizationId: e.organizationId, companyId: e.companyId, department: e.department, aiEmployeeId: e.aiEmployeeId, taskId: e.taskId }).catch((err) => log.warn({ err: err instanceof Error ? err.message : String(err) }, "cost alerts not evaluated"));
    return r.count > 0;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err), sourceType: e.sourceType }, "cost ledger write failed");
    return false;
  }
}

// ───────────── Budgets: check before spend ─────────────

export interface SpendScope {
  organizationId: string;
  companyId: string;
  department?: string | null;
  aiEmployeeId?: string | null;
  taskId?: string | null;
}

type BudgetRow = Prisma.CostBudgetGetPayload<object>;

/** Budgets that apply to a spend in this scope. */
async function applicableBudgets(s: SpendScope): Promise<BudgetRow[]> {
  const or: Prisma.CostBudgetWhereInput[] = [{ scope: "COMPANY", scopeKey: "*" }];
  if (s.department) or.push({ scope: "DEPARTMENT", scopeKey: s.department });
  if (s.aiEmployeeId) or.push({ scope: "AGENT", scopeKey: s.aiEmployeeId });
  if (s.taskId) or.push({ scope: "TASK", scopeKey: "*" });
  return db().costBudget.findMany({ where: { organizationId: s.organizationId, companyId: s.companyId, OR: or } });
}

/** Spend counted against a budget: this UTC month (company / department / agent) or this task (TASK). */
async function spentFor(b: BudgetRow, s: SpendScope): Promise<bigint> {
  const where: Prisma.CostLedgerEntryWhereInput = { organizationId: b.organizationId, companyId: b.companyId };
  if (b.scope === "TASK") {
    if (!s.taskId) return 0n;
    where.taskId = s.taskId;
  } else {
    where.occurredAt = { gte: utcMonthStart() };
    if (b.scope === "DEPARTMENT") where.department = b.scopeKey;
    if (b.scope === "AGENT") where.aiEmployeeId = b.scopeKey;
  }
  const r = await db().costLedgerEntry.aggregate({ where, _sum: { costMicros: true } });
  return r._sum.costMicros ?? 0n;
}

export type SpendCheck =
  | { ok: true }
  | { ok: false; scope: CostBudgetScope; scopeKey: string; limitMicros: bigint; spentMicros: bigint; message: string };

const scopeLabel = (b: { scope: CostBudgetScope; scopeKey: string }) =>
  b.scope === "COMPANY" ? "company's monthly" : b.scope === "DEPARTMENT" ? `${b.scopeKey} department's monthly` : b.scope === "AGENT" ? "AI employee's monthly" : "per-task";

/**
 * May this scope spend `estimateMicros` more? Only hard-stop budgets refuse. Fails open (logged) when the ledger is
 * unavailable, so a missing table never blocks work that platform/workforce budgets already allow.
 */
export async function checkSpend(s: SpendScope, estimateMicros: number | bigint = 0): Promise<SpendCheck> {
  let budgets: BudgetRow[];
  try {
    budgets = await applicableBudgets(s);
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "cost budgets unavailable; not enforced");
    return { ok: true };
  }
  const est = big(estimateMicros);
  for (const b of budgets) {
    if (!b.hardStop) continue;
    const spent = await spentFor(b, s);
    if (spent + est > b.limitMicros || spent >= b.limitMicros) {
      return { ok: false, scope: b.scope, scopeKey: b.scopeKey, limitMicros: b.limitMicros, spentMicros: spent, message: `The ${scopeLabel(b)} spending budget is reached` };
    }
  }
  return { ok: true };
}

/** Throws not_available (reason costs_budget_reached) when a hard-stop budget is reached, and notifies once. */
export async function assertSpendAllowed(s: SpendScope, estimateMicros: number | bigint = 0) {
  const r = await checkSpend(s, estimateMicros);
  if (!r.ok) {
    await evaluateAlerts(s).catch(() => undefined);
    throw new AppError("not_available", `${r.message}; nothing more was spent. Raise the budget in Costs or wait for the next period.`, { reason: "costs_budget_reached", scope: r.scope });
  }
}

/** Write alerts for every reached threshold of the applicable budgets; notify managers about the highest new one. */
export async function evaluateAlerts(s: SpendScope): Promise<number> {
  const budgets = await applicableBudgets(s);
  let sent = 0;
  for (const b of budgets) {
    if (b.limitMicros <= 0n) continue;
    if (b.scope === "TASK" && !s.taskId) continue;
    const spent = await spentFor(b, s);
    const pct = Number((spent * 1000n) / b.limitMicros) / 10;
    const reached = ALERT_THRESHOLDS.filter((t) => pct >= t);
    if (!reached.length) continue;
    const periodKey = b.scope === "TASK" ? s.taskId! : monthKey();
    const created = await db().costAlert.createMany({
      skipDuplicates: true,
      data: reached.map((threshold) => ({ organizationId: b.organizationId, companyId: b.companyId, budgetId: b.id, threshold, periodKey, spentMicros: spent, limitMicros: b.limitMicros })),
    });
    if (!created.count) continue;
    const top = reached[reached.length - 1]!;
    sent++;
    await transaction(async (tx) => {
      const recipients = await usersWithPermission(tx, b.organizationId, b.companyId, "agents.manage");
      const title = `${scopeLabel(b).replace(/^./, (c) => c.toUpperCase())} budget ${top}% used`;
      await notifyUsers(tx, b.organizationId, recipients, top >= 100 ? "costs.budgetReached" : "costs.budgetAlert", { companyId: b.companyId, title, href: "/costs" });
    });
  }
  return sent;
}

// ───────────── Budget management ─────────────

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "agents.read" | "agents.manage", tx?: Tx) {
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), organizationId, companyId), tx);
}

export const costBudgetInput = z.object({
  scope: z.enum(BUDGET_SCOPES),
  scopeKey: z.string().trim().max(60).default("*"),
  /** USD (major units); stored as micro-USD. */
  limitUsd: z.number().min(0.01).max(10_000_000),
  hardStop: z.boolean().default(true),
});

export async function setCostBudget(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof costBudgetInput>) {
  const input = costBudgetInput.parse(raw);
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw invalid("Only a person can set budgets");
  const actorId = ctx.actor.id;
  let scopeKey = input.scopeKey || "*";
  if (input.scope === "COMPANY" || input.scope === "TASK") scopeKey = "*";
  if (input.scope === "DEPARTMENT" && !(BUDGET_DEPARTMENTS as readonly string[]).includes(scopeKey)) throw invalid("Unknown department", { reason: "costs_unknown_department" });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    if (input.scope === "AGENT") {
      const ok = z.string().uuid().safeParse(scopeKey).success && (await tx.aiEmployee.findFirst({ where: { id: scopeKey, organizationId, companyId }, select: { id: true } }));
      if (!ok) throw notFound("AI employee");
    }
    const limitMicros = BigInt(Math.round(input.limitUsd * 1_000_000));
    const before = await tx.costBudget.findUnique({ where: { companyId_scope_scopeKey: { companyId, scope: input.scope, scopeKey } } });
    const row = await tx.costBudget.upsert({
      where: { companyId_scope_scopeKey: { companyId, scope: input.scope, scopeKey } },
      create: { organizationId, companyId, scope: input.scope, scopeKey, limitMicros, hardStop: input.hardStop, updatedById: actorId },
      update: { limitMicros, hardStop: input.hardStop, updatedById: actorId },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "cost_budget.set",
      resourceType: "cost_budget",
      resourceId: row.id,
      oldValue: before ? { limitMicros: before.limitMicros.toString(), hardStop: before.hardStop } : null,
      newValue: { companyId, scope: input.scope, scopeKey, limitMicros: limitMicros.toString(), hardStop: input.hardStop },
    });
    return { id: row.id };
  });
}

export async function deleteCostBudget(ctx: RequestContext, organizationId: string, companyId: string, budgetId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    if (!z.string().uuid().safeParse(budgetId).success) throw notFound("Budget");
    const row = await tx.costBudget.findFirst({ where: { id: budgetId, organizationId, companyId } });
    if (!row) throw notFound("Budget");
    await tx.costBudget.delete({ where: { id: row.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "cost_budget.removed", resourceType: "cost_budget", resourceId: row.id, oldValue: { scope: row.scope, scopeKey: row.scopeKey, limitMicros: row.limitMicros.toString() } });
    return { ok: true };
  });
}

// ───────────── Dashboard ─────────────

const deptOfProfile = new Map(AGENT_PROFILES.map((p) => [p.key, p.department ?? "operations"]));
export const departmentOfProfile = (key: string) => deptOfProfile.get(key) ?? "operations";

const str = (v: bigint | null | undefined) => (v ?? 0n).toString();

/** Everything the /costs dashboard shows, from ledger rows only. Amounts are micro-USD strings. */
export async function costOverview(ctx: RequestContext, organizationId: string, companyId: string, raw: { days?: unknown } = {}) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  const days = Math.min(90, Math.max(7, Number(raw.days) || 30));
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  const month = utcMonthStart(now);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const scope = { organizationId, companyId };
  const range = { ...scope, occurredAt: { gte: from } };
  const [monthSum, todaySum, rangeSum, byDept, byAgent, byProvider, byModel, byCategory, rows, budgets, alerts, recent, first] = await Promise.all([
    db().costLedgerEntry.aggregate({ where: { ...scope, occurredAt: { gte: month } }, _sum: { costMicros: true } }),
    db().costLedgerEntry.aggregate({ where: { ...scope, occurredAt: { gte: today } }, _sum: { costMicros: true } }),
    db().costLedgerEntry.aggregate({ where: range, _sum: { costMicros: true, inputTokens: true, outputTokens: true, cachedTokens: true, cacheWriteTokens: true }, _count: { _all: true } }),
    db().costLedgerEntry.groupBy({ by: ["department"], where: range, _sum: { costMicros: true }, _count: { _all: true } }),
    db().costLedgerEntry.groupBy({ by: ["aiEmployeeId"], where: { ...range, aiEmployeeId: { not: null } }, _sum: { costMicros: true }, _count: { _all: true } }),
    db().costLedgerEntry.groupBy({ by: ["provider"], where: range, _sum: { costMicros: true }, _count: { _all: true } }),
    db().costLedgerEntry.groupBy({ by: ["model"], where: { ...range, model: { not: null } }, _sum: { costMicros: true, inputTokens: true, outputTokens: true, cachedTokens: true }, _count: { _all: true } }),
    db().costLedgerEntry.groupBy({ by: ["category"], where: range, _sum: { costMicros: true }, _count: { _all: true } }),
    db().costLedgerEntry.findMany({ where: range, select: { occurredAt: true, costMicros: true }, take: 100_000 }),
    db().costBudget.findMany({ where: scope, orderBy: [{ scope: "asc" }, { scopeKey: "asc" }] }),
    db().costAlert.findMany({ where: scope, orderBy: { sentAt: "desc" }, take: 10, include: { budget: { select: { scope: true, scopeKey: true } } } }),
    db().costLedgerEntry.findMany({ where: scope, orderBy: { occurredAt: "desc" }, take: 15, select: { id: true, occurredAt: true, category: true, provider: true, model: true, operation: true, department: true, aiEmployeeId: true, taskId: true, units: true, unit: true, costMicros: true, estimated: true } }),
    db().costLedgerEntry.findFirst({ where: scope, orderBy: { occurredAt: "asc" }, select: { occurredAt: true } }),
  ]);
  const employeeIds = [...new Set([...byAgent.map((a) => a.aiEmployeeId!), ...budgets.filter((b) => b.scope === "AGENT").map((b) => b.scopeKey), ...recent.map((r) => r.aiEmployeeId).filter((v): v is string => !!v)])];
  const employees = employeeIds.length ? await db().aiEmployee.findMany({ where: { ...scope, id: { in: employeeIds } }, select: { id: true, name: true, department: true } }) : [];
  const nameOf = (id: string | null) => employees.find((e) => e.id === id)?.name ?? null;

  // Spend per UTC day across the range (zero-filled, so the chart never invents or hides days).
  const perDay = new Map<string, bigint>();
  for (let i = 0; i < days; i++) perDay.set(new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10), 0n);
  for (const r of rows) {
    const k = r.occurredAt.toISOString().slice(0, 10);
    if (perDay.has(k)) perDay.set(k, perDay.get(k)! + r.costMicros);
  }

  // Run-rate forecast: month-to-date spend / elapsed days × days in the month (only once there is spend).
  const mtd = monthSum._sum.costMicros ?? 0n;
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = Math.max(1, (now.getTime() - month.getTime()) / 86_400_000);
  const dailyRate = Number(mtd) / elapsed;
  const projected = mtd > 0n ? BigInt(Math.round(dailyRate * daysInMonth)) : 0n;

  const budgetRows = await Promise.all(
    budgets.map(async (b) => {
      const spent = b.scope === "TASK" ? await maxTaskSpend(organizationId, companyId, month) : await spentFor(b, { organizationId, companyId });
      const pct = b.limitMicros > 0n ? Number((spent * 1000n) / b.limitMicros) / 10 : 0;
      const projectedPct = b.scope === "COMPANY" && b.limitMicros > 0n ? Number((projected * 1000n) / b.limitMicros) / 10 : null;
      return { id: b.id, scope: b.scope, scopeKey: b.scopeKey, label: b.scope === "AGENT" ? (nameOf(b.scopeKey) ?? b.scopeKey.slice(0, 8)) : b.scopeKey, limitMicros: str(b.limitMicros), spentMicros: str(spent), pct, projectedPct, hardStop: b.hardStop, reached: pct >= 100 };
    }),
  );
  const tokens = rangeSum._sum;
  const promptTokens = (tokens.inputTokens ?? 0) + (tokens.cachedTokens ?? 0) + (tokens.cacheWriteTokens ?? 0);
  return {
    days,
    since: first?.occurredAt.toISOString() ?? null,
    totals: {
      monthMicros: str(mtd),
      todayMicros: str(todaySum._sum.costMicros),
      rangeMicros: str(rangeSum._sum.costMicros),
      entries: rangeSum._count._all,
      dailyRateMicros: String(Math.round(dailyRate)),
      projectedMonthMicros: str(projected),
      daysInMonth,
      inputTokens: tokens.inputTokens ?? 0,
      outputTokens: tokens.outputTokens ?? 0,
      cachedTokens: tokens.cachedTokens ?? 0,
      cacheHitPct: promptTokens ? Math.round(((tokens.cachedTokens ?? 0) / promptTokens) * 1000) / 10 : 0,
    },
    byDay: [...perDay.entries()].map(([day, micros]) => ({ day, micros: micros.toString() })),
    byDepartment: byDept.map((d) => ({ key: d.department ?? "unassigned", micros: str(d._sum.costMicros), count: d._count._all })).sort((a, b) => Number(BigInt(b.micros) - BigInt(a.micros))),
    byAgent: byAgent.map((a) => ({ id: a.aiEmployeeId!, name: nameOf(a.aiEmployeeId) ?? a.aiEmployeeId!.slice(0, 8), micros: str(a._sum.costMicros), count: a._count._all })).sort((a, b) => Number(BigInt(b.micros) - BigInt(a.micros))).slice(0, 15),
    byProvider: byProvider.map((p) => ({ key: p.provider, micros: str(p._sum.costMicros), count: p._count._all })).sort((a, b) => Number(BigInt(b.micros) - BigInt(a.micros))),
    byModel: byModel.map((m) => ({ key: m.model!, micros: str(m._sum.costMicros), count: m._count._all, inputTokens: m._sum.inputTokens ?? 0, outputTokens: m._sum.outputTokens ?? 0, cachedTokens: m._sum.cachedTokens ?? 0 })).sort((a, b) => Number(BigInt(b.micros) - BigInt(a.micros))),
    byCategory: byCategory.map((c) => ({ key: c.category, micros: str(c._sum.costMicros), count: c._count._all })).sort((a, b) => Number(BigInt(b.micros) - BigInt(a.micros))),
    budgets: budgetRows,
    alerts: alerts.map((a) => ({ id: a.id, threshold: a.threshold, periodKey: a.periodKey, scope: a.budget.scope, scopeKey: a.budget.scope === "AGENT" ? (nameOf(a.budget.scopeKey) ?? a.budget.scopeKey.slice(0, 8)) : a.budget.scopeKey, spentMicros: str(a.spentMicros), limitMicros: str(a.limitMicros), sentAt: a.sentAt.toISOString() })),
    recent: recent.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString(), costMicros: str(r.costMicros), employee: nameOf(r.aiEmployeeId) })),
    employees: (await db().aiEmployee.findMany({ where: { ...scope, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 })).map((e) => ({ id: e.id, name: e.name })),
  };
}

/** The most expensive single task this month (for showing a TASK budget's headroom). */
async function maxTaskSpend(organizationId: string, companyId: string, since: Date): Promise<bigint> {
  const rows = await db().costLedgerEntry.groupBy({ by: ["taskId"], where: { organizationId, companyId, taskId: { not: null }, occurredAt: { gte: since } }, _sum: { costMicros: true }, orderBy: { _sum: { costMicros: "desc" } }, take: 1 });
  return rows[0]?._sum.costMicros ?? 0n;
}

export type CostOverview = Awaited<ReturnType<typeof costOverview>>;
