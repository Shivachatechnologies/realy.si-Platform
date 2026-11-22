import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, transaction, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { toJson } from "@/server/core/json";
import { getControls } from "@/server/core/platform-controls";
import { providerOf } from "@/server/modules/agents/providers/catalog";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { daysAgo, isUuid, reasonSchema, requireAnyPlatform, utcDayStart, utcMonthStart } from "./access";
import { notifyAdmins } from "./notifications";

/**
 * Cost-control center (stream C): platform AI budgets.
 *
 * Rules live in `platform_settings` (`ai:budgets`), like the other AI controls: one row per limit with a level
 * (global, organization, department, AI employee, user, provider, model), a period (UTC day or UTC month), a USD
 * limit, a soft threshold (percent; notifies admins) and a hard flag (refuses new AI calls once reached). Hard limits
 * are enforced before every model call by `platformBudgetRefusal(scope)` (admin/ai-models.ts → `budgetRefusal`).
 *
 * Spend sources (real, never estimated here):
 *  - `cost_ledger_entries` (category AI_TOKENS) for every tenant model call (agent turns, quick calls, Voice OS);
 *  - `ai_request_logs` rows without an organization for platform calls (Admin Copilot), which have no tenant ledger;
 *  - `ai_request_logs` for the user level (the ledger has no user column), so user spend counts from when the request
 *    log was introduced.
 * Spend per rule is cached 60 s per process, so enforcement costs one aggregate per rule per minute.
 */

export const BUDGET_LEVELS = ["global", "organization", "department", "agent", "user", "provider", "model"] as const;
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];
export const BUDGET_PERIODS = ["daily", "monthly"] as const;
const BUDGETS_KEY = "ai:budgets";

const rule = z.object({
  id: z.string().uuid(),
  level: z.enum(BUDGET_LEVELS),
  /** "*" (global), an organization / AI employee / user id, a department key, a provider key or a model id. */
  key: z.string().min(1).max(120),
  period: z.enum(BUDGET_PERIODS),
  limitUsd: z.number().min(0.01).max(100_000_000),
  /** Percent of the limit at which admins are notified (soft limit). */
  softPct: z.number().int().min(1).max(100).default(80),
  /** Refuse new AI calls once the limit is reached (else notify only). */
  hard: z.boolean().default(true),
  note: z.string().max(200).nullable().default(null),
});
export type BudgetRule = z.infer<typeof rule>;
const rules = z.array(rule).max(200);

let rulesCache: { at: number; rules: BudgetRule[] } | null = null;
async function readRules(): Promise<BudgetRule[]> {
  if (!rulesCache || Date.now() - rulesCache.at > 30_000) {
    const row = await db().platformSetting.findUnique({ where: { key: BUDGETS_KEY } });
    const p = rules.safeParse(row?.value);
    rulesCache = { at: Date.now(), rules: p.success ? p.data : [] };
  }
  return rulesCache.rules;
}

const periodStart = (period: BudgetRule["period"]) => (period === "daily" ? utcDayStart() : utcMonthStart());
const periodKey = (period: BudgetRule["period"]) => {
  const d = new Date().toISOString();
  return period === "daily" ? d.slice(0, 10) : d.slice(0, 7);
};

/** Real AI spend (micro-USD) of one rule's scope in its current period. */
export async function ruleSpend(r: Pick<BudgetRule, "level" | "key" | "period">): Promise<bigint> {
  const since = periodStart(r.period);
  if (r.level === "user") {
    const a = await db().aiRequestLog.aggregate({ where: { userId: isUuid(r.key) ? r.key : undefined, createdAt: { gte: since } }, _sum: { costMicros: true } });
    return isUuid(r.key) ? (a._sum.costMicros ?? 0n) : 0n;
  }
  const ledger: Prisma.CostLedgerEntryWhereInput = { category: "AI_TOKENS", occurredAt: { gte: since } };
  const platform: Prisma.AiRequestLogWhereInput = { organizationId: null, createdAt: { gte: since } };
  let includePlatform = true;
  switch (r.level) {
    case "organization":
      if (!isUuid(r.key)) return 0n;
      ledger.organizationId = r.key;
      includePlatform = false;
      break;
    case "department":
      ledger.department = r.key;
      platform.department = r.key;
      break;
    case "agent":
      if (!isUuid(r.key)) return 0n;
      ledger.aiEmployeeId = r.key;
      includePlatform = false;
      break;
    case "provider":
      ledger.provider = r.key;
      platform.provider = r.key;
      break;
    case "model":
      ledger.model = r.key;
      platform.servedModel = r.key;
      break;
  }
  const [l, p] = await Promise.all([
    db().costLedgerEntry.aggregate({ where: ledger, _sum: { costMicros: true } }),
    includePlatform ? db().aiRequestLog.aggregate({ where: platform, _sum: { costMicros: true } }) : Promise.resolve(null),
  ]);
  return (l._sum.costMicros ?? 0n) + (p?._sum.costMicros ?? 0n);
}

const spendCache = new Map<string, { at: number; micros: bigint }>();
const SPEND_TTL_MS = 60_000;
async function cachedSpend(r: BudgetRule): Promise<bigint> {
  const k = `${r.id}:${periodKey(r.period)}`;
  const hit = spendCache.get(k);
  if (hit && Date.now() - hit.at < SPEND_TTL_MS) return hit.micros;
  const micros = await ruleSpend(r);
  spendCache.set(k, { at: Date.now(), micros });
  if (spendCache.size > 1_000) spendCache.clear();
  return micros;
}

/**
 * Budget rules at or over their soft limit this period (Action Center `ai.budgets`, stream A). No permission check:
 * the Action Center shows the item only to admins who may open /ai/budgets. Spend reads share the 60 s cache.
 */
export async function budgetRulesAtRisk(): Promise<{ id: string; level: BudgetRule["level"]; key: string; period: BudgetRule["period"]; pct: number; hard: boolean }[]> {
  const out: { id: string; level: BudgetRule["level"]; key: string; period: BudgetRule["period"]; pct: number; hard: boolean }[] = [];
  for (const r of await readRules()) {
    const limit = Math.round(r.limitUsd * 1_000_000);
    const pct = limit ? Number(await cachedSpend(r)) / limit : 0;
    if (pct * 100 >= r.softPct) out.push({ id: r.id, level: r.level, key: r.key, period: r.period, pct, hard: r.hard });
  }
  return out.sort((a, b) => b.pct - a.pct);
}


export interface BudgetScope {
  organizationId?: string | null;
  department?: string | null;
  aiEmployeeId?: string | null;
  userId?: string | null;
  model?: string | null;
}

function applies(r: BudgetRule, s: BudgetScope): boolean {
  switch (r.level) {
    case "global":
      return true;
    case "organization":
      return !!s.organizationId && r.key === s.organizationId;
    case "department":
      return !!s.department && r.key === s.department;
    case "agent":
      return !!s.aiEmployeeId && r.key === s.aiEmployeeId;
    case "user":
      return !!s.userId && r.key === s.userId;
    case "provider":
      return !!s.model && r.key === providerOf(s.model);
    case "model":
      return !!s.model && r.key === s.model;
  }
}

const notified = new Set<string>();
function maybeNotify(r: BudgetRule, spent: bigint) {
  const limit = BigInt(Math.round(r.limitUsd * 1_000_000));
  if (limit <= 0n) return;
  const pct = Number((spent * 1000n) / limit) / 10;
  const level = pct >= 100 ? 100 : pct >= r.softPct ? r.softPct : null;
  if (level === null) return;
  const dedupeKey = `ai-budget:${r.id}:${periodKey(r.period)}:${level}`;
  if (notified.has(dedupeKey)) return;
  notified.add(dedupeKey);
  void notifyAdmins(null, {
    permission: "platform.ai.manage",
    type: level >= 100 ? "ai.budget_reached" : "ai.budget_threshold",
    severity: level >= 100 ? "CRITICAL" : "WARNING",
    title: `AI budget ${r.level}${r.key === "*" ? "" : ` ${r.key}`} (${r.period}) at ${Math.floor(pct)}%`,
    href: "/ai/budgets",
    dedupeKey,
    payload: { ruleId: r.id, spentMicros: spent.toString(), limitUsd: r.limitUsd, hard: r.hard },
  }).catch(() => undefined);
}

/**
 * The first hard rule that applies to this scope and is used up, else null. Soft thresholds notify admins (once per
 * rule, period and threshold). Fails open (logged) when the budget store is unavailable.
 */
export async function budgetRefusal(scope: BudgetScope): Promise<BudgetRule | null> {
  let list: BudgetRule[];
  try {
    list = (await readRules()).filter((r) => applies(r, scope));
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "AI budgets unavailable; not enforced");
    return null;
  }
  for (const r of list) {
    try {
      const spent = await cachedSpend(r);
      maybeNotify(r, spent);
      if (r.hard && spent >= BigInt(Math.round(r.limitUsd * 1_000_000))) return r;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), rule: r.id }, "AI budget spend unavailable; not enforced");
    }
  }
  return null;
}

// ───────────── Admin: budgets center ─────────────

const AI_READ = ["platform.ai.read", "platform.ai.manage"];
const daysInMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

/** Linear month-end projection: spend so far ÷ elapsed fraction of the month (null in the month's first hour). */
export function projectMonthEnd(spentMicros: number, now = new Date()): number | null {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const elapsed = (now.getTime() - start) / 86_400_000;
  if (elapsed < 1 / 24) return null;
  return Math.round((spentMicros / elapsed) * daysInMonth(now));
}

/** Linear end-of-day projection. */
export function projectDayEnd(spentMicros: number, now = new Date()): number | null {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const elapsed = (now.getTime() - start) / 86_400_000;
  if (elapsed < 1 / 24) return null;
  return Math.round(spentMicros / elapsed);
}

/**
 * Simple anomaly rule (documented in the UI): an organization whose AI spend on one of the last 2 UTC days is more
 * than 3× its median day of the 7 days before and above $1. Median of days with spend (missing days count as 0).
 */
export function spendAnomalies(rows: { organizationId: string; day: string; micros: number }[], today = new Date()): { organizationId: string; day: string; micros: number; baselineMicros: number; ratio: number }[] {
  const dayKey = (n: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - n)).toISOString().slice(0, 10);
  const byOrg = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = byOrg.get(r.organizationId) ?? new Map<string, number>();
    m.set(r.day, (m.get(r.day) ?? 0) + r.micros);
    byOrg.set(r.organizationId, m);
  }
  const out: { organizationId: string; day: string; micros: number; baselineMicros: number; ratio: number }[] = [];
  for (const [org, days] of byOrg) {
    const base = [2, 3, 4, 5, 6, 7, 8].map((n) => days.get(dayKey(n)) ?? 0).sort((a, b) => a - b);
    const median = base[3]!;
    for (const n of [0, 1]) {
      const v = days.get(dayKey(n)) ?? 0;
      if (v > 1_000_000 && v > 3 * Math.max(median, 1)) {
        out.push({ organizationId: org, day: dayKey(n), micros: v, baselineMicros: median, ratio: median > 0 ? v / median : Infinity });
        break;
      }
    }
  }
  return out.sort((a, b) => b.micros - a.micros);
}

let overviewCache: { at: number; value: Awaited<ReturnType<typeof computeOverview>> } | null = null;

async function computeOverview() {
  const monthStart = utcMonthStart();
  const [list, monthLedger, monthPlatform, todayLedger, todayPlatform, daily, tenantBudgets] = await Promise.all([
    readRules(),
    db().costLedgerEntry.aggregate({ where: { category: "AI_TOKENS", occurredAt: { gte: monthStart } }, _sum: { costMicros: true } }),
    db().aiRequestLog.aggregate({ where: { organizationId: null, createdAt: { gte: monthStart } }, _sum: { costMicros: true } }),
    db().costLedgerEntry.aggregate({ where: { category: "AI_TOKENS", occurredAt: { gte: utcDayStart() } }, _sum: { costMicros: true } }),
    db().aiRequestLog.aggregate({ where: { organizationId: null, createdAt: { gte: utcDayStart() } }, _sum: { costMicros: true } }),
    db().$queryRaw<{ organization_id: string; day: Date; micros: bigint }[]>(Prisma.sql`
      SELECT organization_id, date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS day, SUM(cost_micros)::bigint AS micros
      FROM cost_ledger_entries WHERE category = 'AI_TOKENS' AND occurred_at >= ${daysAgo(10)} GROUP BY 1, 2`),
    db().costBudget.findMany({ orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, organizationId: true, companyId: true, scope: true, scopeKey: true, limitMicros: true, hardStop: true, updatedAt: true } }),
  ]);
  const ruleRows = await Promise.all(
    list.map(async (r) => {
      const spent = Number(await ruleSpend(r));
      const limit = Math.round(r.limitUsd * 1_000_000);
      const projected = r.period === "monthly" ? projectMonthEnd(spent) : projectDayEnd(spent);
      const pct = limit ? spent / limit : 0;
      return { ...r, spentMicros: spent, limitMicros: limit, pct, projectedMicros: projected, state: pct >= 1 ? (r.hard ? "blocked" : "over") : pct * 100 >= r.softPct ? "soft" : "ok" };
    }),
  );
  const monthSpent = Number(monthLedger._sum.costMicros ?? 0n) + Number(monthPlatform._sum.costMicros ?? 0n);
  const todaySpent = Number(todayLedger._sum.costMicros ?? 0n) + Number(todayPlatform._sum.costMicros ?? 0n);
  const anomalies = spendAnomalies(daily.map((d) => ({ organizationId: d.organization_id, day: d.day.toISOString().slice(0, 10), micros: Number(d.micros) })));
  // Tenant budgets: this month's spend per budget (company / department / agent) from the ledger.
  const tenantSpend = await Promise.all(
    tenantBudgets.map(async (b) => {
      if (b.scope === "TASK") return null;
      const where: Prisma.CostLedgerEntryWhereInput = { organizationId: b.organizationId, companyId: b.companyId, occurredAt: { gte: monthStart } };
      if (b.scope === "DEPARTMENT") where.department = b.scopeKey;
      if (b.scope === "AGENT") where.aiEmployeeId = b.scopeKey;
      return Number((await db().costLedgerEntry.aggregate({ where, _sum: { costMicros: true } }))._sum.costMicros ?? 0n);
    }),
  );
  const orgIds = [...new Set([...tenantBudgets.map((b) => b.organizationId), ...anomalies.map((a) => a.organizationId), ...list.filter((r) => r.level === "organization").map((r) => r.key).filter(isUuid)])];
  const companyIds = [...new Set(tenantBudgets.map((b) => b.companyId))];
  const [orgs, companies] = await Promise.all([
    db().organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }),
    db().company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }),
  ]);
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? id.slice(0, 8);
  return {
    computedAt: new Date().toISOString(),
    month: { spentMicros: monthSpent, projectedMicros: projectMonthEnd(monthSpent) },
    today: { spentMicros: todaySpent, projectedMicros: projectDayEnd(todaySpent) },
    rules: ruleRows.map((r) => ({ ...r, keyLabel: r.level === "organization" ? orgName(r.key) : r.key })),
    anomalies: anomalies.slice(0, 20).map((a) => ({ ...a, organizationName: orgName(a.organizationId), ratio: Number.isFinite(a.ratio) ? a.ratio : null })),
    tenantBudgets: tenantBudgets.map((b, i) => ({
      ...b,
      limitMicros: Number(b.limitMicros),
      spentMicros: tenantSpend[i],
      organizationName: orgName(b.organizationId),
      companyName: companies.find((c) => c.id === b.companyId)?.name ?? b.companyId.slice(0, 8),
    })),
  };
}

/** Budgets center data (cached 60 s; `fresh` bypasses the cache). */
export async function aiBudgetsOverview(ctx: RequestContext, opts: { fresh?: boolean } = {}) {
  await requireAnyPlatform(ctx, AI_READ);
  if (opts.fresh || !overviewCache || Date.now() - overviewCache.at > 60_000) overviewCache = { at: Date.now(), value: await computeOverview() };
  const c = await getControls();
  return { ...overviewCache.value, stopped: { aiWorkforceEnabled: c.aiWorkforceEnabled, aiExecutionPaused: c.aiExecutionPaused, tokenDaily: c.aiDailyTokenBudget, tokenMonthly: c.aiMonthlyTokenBudget } };
}

export const budgetRuleInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("upsert"),
    id: z.string().uuid().optional(),
    level: z.enum(BUDGET_LEVELS),
    key: z.string().trim().min(1).max(120),
    period: z.enum(BUDGET_PERIODS),
    limitUsd: z.number().min(0.01).max(100_000_000),
    softPct: z.number().int().min(1).max(100).default(80),
    hard: z.boolean().default(true),
    note: z.string().trim().max(200).nullable().default(null),
    reason: reasonSchema,
  }),
  z.object({ action: z.literal("delete"), id: z.string().uuid(), reason: reasonSchema }),
]);

async function validateKey(level: BudgetLevel, key: string): Promise<string> {
  if (level === "global") return "*";
  if (level === "organization") {
    if (!isUuid(key) || !(await db().organization.findUnique({ where: { id: key }, select: { id: true } }))) throw notFound("Organization");
  } else if (level === "agent") {
    if (!isUuid(key) || !(await db().aiEmployee.findUnique({ where: { id: key }, select: { id: true } }))) throw notFound("AI employee");
  } else if (level === "user") {
    if (!isUuid(key) || !(await db().user.findUnique({ where: { id: key }, select: { id: true } }))) throw notFound("User");
  } else if (!/^[a-z0-9._@:-]{2,120}$/.test(key)) throw notFound(level === "department" ? "Department" : level === "provider" ? "Provider" : "Model");
  return key;
}

/** Create, change or remove one platform budget rule (platform.ai.manage), audited with old and new values. */
export async function updateBudgetRule(ctx: RequestContext, raw: z.input<typeof budgetRuleInput>) {
  const input = budgetRuleInput.parse(raw);
  const key = input.action === "upsert" ? await validateKey(input.level, input.key) : null;
  const result = await transaction(async (tx) => {
    await requirePermission(ctx, "platform.ai.manage", platformChain(), tx);
    const row = await tx.platformSetting.findUnique({ where: { key: BUDGETS_KEY } });
    const parsed = rules.safeParse(row?.value);
    const cur = parsed.success ? parsed.data : [];
    let next: BudgetRule[];
    let before: BudgetRule | null = null;
    let after: BudgetRule | null = null;
    if (input.action === "delete") {
      before = cur.find((r) => r.id === input.id) ?? null;
      if (!before) throw notFound("Budget");
      next = cur.filter((r) => r.id !== input.id);
    } else {
      before = input.id ? (cur.find((r) => r.id === input.id) ?? null) : null;
      if (input.id && !before) throw notFound("Budget");
      const dup = cur.find((r) => r.id !== input.id && r.level === input.level && r.key === key && r.period === input.period);
      if (dup) throw conflict("A budget for this scope and period already exists; edit it instead", { reason: "ai_budget_duplicate" });
      after = { id: before?.id ?? randomUUID(), level: input.level, key: key!, period: input.period, limitUsd: input.limitUsd, softPct: input.softPct, hard: input.hard, note: input.note };
      next = before ? cur.map((r) => (r.id === before!.id ? after! : r)) : [...cur, after];
      if (next.length > 200) throw conflict("Too many budgets (200 max)");
    }
    const json = toJson(next) as Prisma.InputJsonValue;
    await tx.platformSetting.upsert({ where: { key: BUDGETS_KEY }, create: { key: BUDGETS_KEY, value: json, updatedById: ctx.actor.id, reason: input.reason }, update: { value: json, updatedById: ctx.actor.id, reason: input.reason } });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId: (after ?? before)?.level === "organization" ? (after ?? before)!.key : undefined,
      action: input.action === "delete" ? "platform.ai.budget_removed" : before ? "platform.ai.budget_changed" : "platform.ai.budget_created",
      resourceType: "ai_budget",
      resourceId: (after ?? before)!.id,
      oldValue: before,
      newValue: after,
      reason: input.reason,
    });
    return { id: (after ?? before)!.id };
  });
  rulesCache = null;
  overviewCache = null;
  spendCache.clear();
  return result;
}

export const tenantBudgetInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), limitUsd: z.number().min(0.01).max(10_000_000), hardStop: z.boolean(), reason: reasonSchema }),
  z.object({ action: z.literal("delete"), reason: reasonSchema, confirm: z.string().optional() }),
]);

/**
 * Platform override of one tenant cost budget (`cost_budgets`): change the limit / hard stop, or remove it. The
 * tenant's own budget table and enforcement (costs/service.ts checkSpend) stay the source of truth; the change is
 * audited in the tenant's organization as an ADMIN action with the reason.
 */
export async function adminTenantBudget(ctx: RequestContext, budgetId: string, raw: z.input<typeof tenantBudgetInput>) {
  const input = tenantBudgetInput.parse(raw);
  if (!isUuid(budgetId)) throw notFound("Budget");
  const r = await transaction(async (tx) => {
    await requirePermission(ctx, "platform.ai.manage", platformChain(), tx);
    const row = await tx.costBudget.findUnique({ where: { id: budgetId } });
    if (!row) throw notFound("Budget");
    const oldValue = { companyId: row.companyId, scope: row.scope, scopeKey: row.scopeKey, limitMicros: row.limitMicros.toString(), hardStop: row.hardStop };
    if (input.action === "delete") {
      await tx.costBudget.delete({ where: { id: row.id } });
      await writeAudit(tx, ctx, { category: "ADMIN", organizationId: row.organizationId, action: "platform.ai.tenant_budget_removed", resourceType: "cost_budget", resourceId: row.id, oldValue, reason: input.reason });
      return { ok: true };
    }
    if (!ctx.actor.id) throw conflict("Only a person can change budgets");
    const limitMicros = BigInt(Math.round(input.limitUsd * 1_000_000));
    await tx.costBudget.update({ where: { id: row.id }, data: { limitMicros, hardStop: input.hardStop, updatedById: ctx.actor.id } });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: row.organizationId, action: "platform.ai.tenant_budget_changed", resourceType: "cost_budget", resourceId: row.id, oldValue, newValue: { limitMicros: limitMicros.toString(), hardStop: input.hardStop }, reason: input.reason });
    return { ok: true };
  });
  overviewCache = null;
  return r;
}

/** Test seam. */
export function resetBudgetCaches() {
  rulesCache = null;
  overviewCache = null;
  spendCache.clear();
  notified.clear();
}
