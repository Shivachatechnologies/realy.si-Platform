import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import {
  actorId,
  addDays,
  addMonths,
  advance,
  amount,
  authorize,
  companyInfo,
  day,
  dayString,
  fromMinor,
  isUuid,
  monthKey,
  monthStart,
  optionalText,
  PER_MONTH,
  todayUtc,
  toCsv,
  toDay,
  toMinor,
  type DateRange,
} from "./common";
import { balanceOf, OPEN_STATUSES } from "./billing";
import { ensureFinanceSetup, ledgerTotals } from "./ledger";
import { accountBalances } from "./setup";
import { budgetVsActual } from "./transactions";

const months = (from: Date, to: Date) => {
  const out: string[] = [];
  for (let m = monthStart(from); m < to; m = addMonths(m, 1)) out.push(monthKey(m));
  return out;
};
const avg = (xs: bigint[]) => (xs.length ? xs.reduce((s, x) => s + x, 0n) / BigInt(xs.length) : 0n);

// ───────────── Core figures (no authorization: callers authorize) ─────────────

/** Income and expense totals from posted journal lines in the range. */
export async function profitAndLossTotals(client: Tx | Db, companyId: string, range: DateRange) {
  const [accounts, totals] = await Promise.all([client.ledgerAccount.findMany({ where: { companyId, type: { in: ["INCOME", "EXPENSE"] } }, select: { id: true, type: true } }), ledgerTotals(client, companyId, { from: range.from, to: range.to })]);
  let revenue = 0n;
  let expenses = 0n;
  for (const a of accounts) {
    const v = totals.get(a.id) ?? 0n;
    if (a.type === "INCOME") revenue -= v;
    else expenses += v;
  }
  return { revenue, expenses, profit: revenue - expenses };
}

/** Cash in/out per month from the bank register (transfers excluded). */
export async function cashByMonth(client: Tx | Db, companyId: string, range: DateRange) {
  const rows = await client.financeTransaction.findMany({ where: { companyId, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: range.from, lt: range.to } }, select: { type: true, date: true, amountMinor: true, source: true } });
  const keys = months(range.from, range.to);
  const map = new Map(keys.map((k) => [k, { month: k, inflow: 0n, outflow: 0n }]));
  for (const r of rows) {
    const m = map.get(monthKey(r.date));
    if (!m) continue;
    if (r.type === "INCOME") m.inflow += r.amountMinor;
    else m.outflow += r.amountMinor;
  }
  return [...map.values()].map((m) => ({ ...m, net: m.inflow - m.outflow }));
}

export async function cashBalance(client: Tx | Db, companyId: string, asOf?: Date) {
  const b = await accountBalances(client, companyId, asOf);
  return [...b.values()].reduce((s, v) => s + v, 0n);
}

/** Average monthly net burn (outflow − inflow) over the last 3 full months; 0 when cash-flow positive. */
export async function burnRate(client: Tx | Db, companyId: string, now = new Date()) {
  const end = monthStart(todayUtc(now));
  const series = await cashByMonth(client, companyId, { from: addMonths(end, -3), to: end });
  const net = avg(series.map((m) => m.outflow - m.inflow));
  return { netBurn: net > 0n ? net : 0n, grossBurn: avg(series.map((m) => m.outflow)) };
}

export async function recurringRevenue(client: Tx | Db, companyId: string) {
  const templates = await client.recurringInvoice.findMany({ where: { companyId, active: true }, select: { netMinor: true, frequency: true } });
  const mrr = templates.reduce((s, t) => s + BigInt(Math.round(Number(t.netMinor) * PER_MONTH[t.frequency])), 0n);
  return { mrr, arr: mrr * 12n };
}

export async function overdueReceivables(client: Tx | Db, companyId: string, asOf = todayUtc()) {
  const rows = await client.invoice.findMany({ where: { companyId, status: { in: OPEN_STATUSES }, dueDate: { lt: asOf } }, select: { totalMinor: true, paidMinor: true, creditedMinor: true } });
  return rows.reduce((s, r) => s + balanceOf(r), 0n);
}

export async function openReceivables(client: Tx | Db, companyId: string) {
  const rows = await client.invoice.findMany({ where: { companyId, status: { in: OPEN_STATUSES } }, select: { totalMinor: true, paidMinor: true, creditedMinor: true } });
  return rows.reduce((s, r) => s + balanceOf(r), 0n);
}

/**
 * Cash forecast for the next `count` months (starting next month): open invoices by due date (overdue ones in the first
 * month), recurring invoices and expenses on their schedule, planned items, plus the 3-month trend of other income and
 * non-recurring expenses.
 */
export async function cashForecast(client: Tx | Db, companyId: string, count = 6, now = new Date()) {
  const today = todayUtc(now);
  const start = addMonths(monthStart(today), 1);
  const end = addMonths(start, count);
  const histFrom = addMonths(monthStart(today), -3);
  const histTo = monthStart(today);
  const [open, recInv, recExp, plan, hist, cash] = await Promise.all([
    client.invoice.findMany({ where: { companyId, status: { in: OPEN_STATUSES } }, select: { dueDate: true, totalMinor: true, paidMinor: true, creditedMinor: true } }),
    client.recurringInvoice.findMany({ where: { companyId, active: true }, select: { nextIssueDate: true, frequency: true, netMinor: true, endDate: true, dueDays: true } }),
    client.recurringExpense.findMany({ where: { companyId, active: true }, select: { nextRunDate: true, frequency: true, amountMinor: true, endDate: true } }),
    client.cashPlanItem.findMany({ where: { companyId, date: { gte: today, lt: end } }, select: { date: true, amountMinor: true } }),
    client.financeTransaction.findMany({ where: { companyId, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: histFrom, lt: histTo } }, select: { type: true, source: true, amountMinor: true } }),
    cashBalance(client, companyId),
  ]);
  const keys = months(start, end);
  const rows = new Map(keys.map((k) => [k, { month: k, receivables: 0n, recurringIncome: 0n, recurringExpenses: 0n, planned: 0n, trendIncome: 0n, trendExpenses: 0n, inflow: 0n, outflow: 0n, net: 0n, balance: 0n }]));
  const first = keys[0]!;
  for (const i of open) {
    const k = i.dueDate < start ? first : monthKey(i.dueDate);
    const r = rows.get(k);
    if (r) r.receivables += balanceOf(i);
  }
  for (const t of recInv) {
    // Cash arrives at the due date of each generated invoice.
    for (let d = t.nextIssueDate, n = 0; n < 200; d = advance(d, t.frequency), n++) {
      if (t.endDate && d > t.endDate) break;
      const paid = addDays(d, t.dueDays);
      if (paid >= end) break;
      const r = rows.get(paid < start ? first : monthKey(paid));
      if (r) r.recurringIncome += t.netMinor;
    }
  }
  for (const e of recExp) {
    for (let d = e.nextRunDate, n = 0; n < 200 && d < end; d = advance(d, e.frequency), n++) {
      if (e.endDate && d > e.endDate) break;
      const r = rows.get(d < start ? first : monthKey(d));
      if (r) r.recurringExpenses += e.amountMinor;
    }
  }
  for (const p of plan) {
    const r = rows.get(p.date < start ? first : monthKey(p.date));
    if (r) r.planned += p.amountMinor;
  }
  const otherIncome = hist.filter((h) => h.type === "INCOME" && h.source !== "PAYMENT").reduce((s, h) => s + h.amountMinor, 0n) / 3n;
  const otherExpense = hist.filter((h) => h.type === "EXPENSE" && h.source !== "RECURRING").reduce((s, h) => s + h.amountMinor, 0n) / 3n;
  let balance = cash;
  const out = [...rows.values()].map((r) => {
    r.trendIncome = otherIncome;
    r.trendExpenses = otherExpense;
    r.inflow = r.receivables + r.recurringIncome + r.trendIncome + (r.planned > 0n ? r.planned : 0n);
    r.outflow = r.recurringExpenses + r.trendExpenses + (r.planned < 0n ? -r.planned : 0n);
    r.net = r.inflow - r.outflow;
    balance += r.net;
    r.balance = balance;
    return r;
  });
  return { startingCash: cash, months: out };
}

// ───────────── Dashboard ─────────────

export async function financeDashboard(ctx: RequestContext, organizationId: string, companyId: string, range: DateRange, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  await ensureFinanceSetup(db(), organizationId, companyId);
  const client = db();
  const [pnl, cashSeries, cash, burn, rr, overdue, receivables, forecast, monthly] = await Promise.all([
    profitAndLossTotals(client, companyId, range),
    cashByMonth(client, companyId, range),
    cashBalance(client, companyId),
    burnRate(client, companyId, now),
    recurringRevenue(client, companyId),
    overdueReceivables(client, companyId),
    openReceivables(client, companyId),
    cashForecast(client, companyId, 6, now),
    pnlByMonth(client, companyId, range),
  ]);
  const cashIn = cashSeries.reduce((s, m) => s + m.inflow, 0n);
  const cashOut = cashSeries.reduce((s, m) => s + m.outflow, 0n);
  return {
    ...pnl,
    margin: pnl.revenue > 0n ? Number((pnl.profit * 10_000n) / pnl.revenue) / 100 : null,
    cashIn,
    cashOut,
    netCashFlow: cashIn - cashOut,
    cash,
    burn,
    runwayMonths: burn.netBurn > 0n ? Number((cash * 10n) / burn.netBurn) / 10 : null,
    mrr: rr.mrr,
    arr: rr.arr,
    overdue,
    receivables,
    monthly,
    cashSeries,
    forecast,
  };
}

async function pnlByMonth(client: Tx | Db, companyId: string, range: DateRange) {
  const lines = await client.journalLine.findMany({
    where: { companyId, entry: { status: "POSTED", date: { gte: range.from, lt: range.to } }, ledgerAccount: { type: { in: ["INCOME", "EXPENSE"] } } },
    select: { debitMinor: true, creditMinor: true, ledgerAccount: { select: { type: true } }, entry: { select: { date: true } } },
  });
  const map = new Map(months(range.from, range.to).map((k) => [k, { month: k, revenue: 0n, expenses: 0n }]));
  for (const l of lines) {
    const m = map.get(monthKey(l.entry.date));
    if (!m) continue;
    if (l.ledgerAccount.type === "INCOME") m.revenue += l.creditMinor - l.debitMinor;
    else m.expenses += l.debitMinor - l.creditMinor;
  }
  return [...map.values()].map((m) => ({ ...m, profit: m.revenue - m.expenses }));
}

// ───────────── Anomalies ─────────────

/**
 * Expense anomalies by z-score: each expense of the last `days` days is compared with the other expenses of the same
 * category (and, separately, the same vendor) over the past year; |z| ≥ threshold with at least 5 comparable expenses.
 */
export async function detectExpenseAnomalies(ctx: RequestContext, organizationId: string, companyId: string, opts: { days?: number; threshold?: number } = {}, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const days = opts.days ?? 90;
  const threshold = opts.threshold ?? 2.5;
  const today = todayUtc(now);
  const rows = await db().financeTransaction.findMany({
    where: { organizationId, companyId, type: "EXPENSE", date: { gte: addDays(today, -365), lte: today } },
    select: { id: true, date: true, amountMinor: true, description: true, categoryId: true, accountId: true, category: { select: { name: true } }, account: { select: { name: true } } },
    take: 20_000,
  });
  const recentFrom = addDays(today, -days);
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    if (r.categoryId) (groups.get(`c:${r.categoryId}`) ?? groups.set(`c:${r.categoryId}`, []).get(`c:${r.categoryId}`)!).push(Number(r.amountMinor));
    if (r.accountId) (groups.get(`v:${r.accountId}`) ?? groups.set(`v:${r.accountId}`, []).get(`v:${r.accountId}`)!).push(Number(r.amountMinor));
  }
  const stats = new Map<string, { n: number; sum: number; sumSq: number }>();
  for (const [k, xs] of groups) stats.set(k, { n: xs.length, sum: xs.reduce((s, x) => s + x, 0), sumSq: xs.reduce((s, x) => s + x * x, 0) });
  const out: { id: string; date: Date; amountMinor: bigint; description: string; group: "category" | "vendor"; groupName: string; meanMinor: bigint; z: number; samples: number }[] = [];
  for (const r of rows) {
    if (r.date < recentFrom) continue;
    const x = Number(r.amountMinor);
    const candidates: ["category" | "vendor", string | null, string | undefined][] = [
      ["category", r.categoryId ? `c:${r.categoryId}` : null, r.category?.name],
      ["vendor", r.accountId ? `v:${r.accountId}` : null, r.account?.name],
    ];
    let best: (typeof out)[number] | null = null;
    for (const [group, key, name] of candidates) {
      if (!key) continue;
      const s = stats.get(key)!;
      // Leave-one-out so the outlier doesn't mask itself.
      const n = s.n - 1;
      if (n < 5) continue;
      const mean = (s.sum - x) / n;
      const variance = (s.sumSq - x * x - n * mean * mean) / Math.max(1, n - 1);
      const sd = Math.sqrt(Math.max(variance, 0));
      if (sd === 0) continue;
      const z = (x - mean) / sd;
      if (Math.abs(z) >= threshold && (!best || Math.abs(z) > Math.abs(best.z))) {
        best = { id: r.id, date: r.date, amountMinor: r.amountMinor, description: r.description, group, groupName: name ?? "", meanMinor: BigInt(Math.round(mean)), z: Math.round(z * 100) / 100, samples: n };
      }
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 50);
}

// ───────────── Cash planning ─────────────

export const planItemInput = z.object({ name: z.string().trim().min(1).max(200), date: day, amount, notes: optionalText(1000) });

export async function listPlanItems(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  return db().cashPlanItem.findMany({ where: { organizationId, companyId, date: { gte: addMonths(todayUtc(), -1) } }, orderBy: { date: "asc" }, take: 500 });
}

export async function createPlanItem(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof planItemInput>) {
  const input = planItemInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const company = await companyInfo(tx, organizationId, companyId);
    const p = await tx.cashPlanItem.create({ data: { organizationId, companyId, name: input.name, date: toDay(input.date), amountMinor: toMinor(input.amount, company.baseCurrency), notes: input.notes ?? null, createdById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.plan_item.created", resourceType: "cash_plan_item", resourceId: p.id, newValue: input });
    return p;
  });
}

export async function updatePlanItem(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: Partial<z.input<typeof planItemInput>>) {
  const input = planItemInput.partial().parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.cashPlanItem.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Planned item");
    const company = await companyInfo(tx, organizationId, companyId);
    const p = await tx.cashPlanItem.update({ where: { id }, data: { name: input.name, date: input.date ? toDay(input.date) : undefined, amountMinor: input.amount ? toMinor(input.amount, company.baseCurrency) : undefined, notes: input.notes === undefined ? undefined : input.notes } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.plan_item.updated", resourceType: "cash_plan_item", resourceId: id, newValue: input });
    return p;
  });
}

export async function deletePlanItem(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const { count } = isUuid(id) ? await tx.cashPlanItem.deleteMany({ where: { id, organizationId, companyId } }) : { count: 0 };
    if (!count) throw notFound("Planned item");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.plan_item.deleted", resourceType: "cash_plan_item", resourceId: id });
    return { ok: true };
  });
}

// ───────────── Scenarios ─────────────

const oneOff = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), amount, label: z.string().trim().min(1).max(120) });
export const scenarioInput = z.object({
  name: z.string().trim().min(1).max(80),
  /** Percent per month, e.g. 5 or -2.5. */
  revenueGrowth: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().min(-100).max(1000)),
  /** Percent change of monthly expenses vs the baseline. */
  expenseChange: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().min(-100).max(1000)),
  months: z.coerce.number().int().min(1).max(36).default(12),
  oneOffs: z.array(oneOff).max(50).default([]),
});

export async function listScenarios(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  return db().cashScenario.findMany({ where: { organizationId, companyId }, orderBy: { name: "asc" } });
}

function scenarioData(input: z.output<typeof scenarioInput>, currency: string) {
  return {
    name: input.name,
    revenueGrowthBps: Math.round(input.revenueGrowth * 100),
    expenseChangeBps: Math.round(input.expenseChange * 100),
    months: input.months,
    oneOffs: input.oneOffs.map((o) => ({ month: o.month, label: o.label, amountMinor: toMinor(o.amount, currency).toString() })) as unknown as Prisma.InputJsonValue,
  };
}

export async function createScenario(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof scenarioInput>) {
  const input = scenarioInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const company = await companyInfo(tx, organizationId, companyId);
    if (await tx.cashScenario.findFirst({ where: { companyId, name: input.name }, select: { id: true } })) throw conflict("A scenario with this name exists", { reason: "finance_name_taken" });
    const s = await tx.cashScenario.create({ data: { organizationId, companyId, ...scenarioData(input, company.baseCurrency), createdById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.scenario.created", resourceType: "cash_scenario", resourceId: s.id, newValue: { name: s.name } });
    return s;
  });
}

export async function updateScenario(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof scenarioInput>) {
  const input = scenarioInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.cashScenario.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Scenario");
    const company = await companyInfo(tx, organizationId, companyId);
    if (input.name !== before.name && (await tx.cashScenario.findFirst({ where: { companyId, name: input.name }, select: { id: true } }))) throw conflict("A scenario with this name exists", { reason: "finance_name_taken" });
    const s = await tx.cashScenario.update({ where: { id }, data: scenarioData(input, company.baseCurrency) });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.scenario.updated", resourceType: "cash_scenario", resourceId: id, newValue: { name: s.name } });
    return s;
  });
}

export async function deleteScenario(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const { count } = isUuid(id) ? await tx.cashScenario.deleteMany({ where: { id, organizationId, companyId } }) : { count: 0 };
    if (!count) throw notFound("Scenario");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.scenario.deleted", resourceType: "cash_scenario", resourceId: id });
    return { ok: true };
  });
}

/**
 * Project cash by month for each scenario from the 3-month baseline (average monthly inflow and outflow): revenue grows
 * by the monthly rate (compounded), expenses change by the given percent, one-off items land in their month.
 */
export async function projectScenarios(ctx: RequestContext, organizationId: string, companyId: string, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const client = db();
  const end = monthStart(todayUtc(now));
  const [hist, cash, scenarios] = await Promise.all([cashByMonth(client, companyId, { from: addMonths(end, -3), to: end }), cashBalance(client, companyId), listScenarios(ctx, organizationId, companyId)]);
  const baseIn = Number(avg(hist.map((m) => m.inflow)));
  const baseOut = Number(avg(hist.map((m) => m.outflow)));
  const horizon = Math.max(12, ...scenarios.map((s) => s.months));
  const keys = months(addMonths(end, 1), addMonths(end, 1 + horizon));
  const project = (growthBps: number, changeBps: number, oneOffs: { month: string; amountMinor: string }[], count: number) => {
    let balance = Number(cash);
    let runOutMonth: string | null = null;
    const points = keys.slice(0, count).map((k, i) => {
      const inflow = baseIn * Math.pow(1 + growthBps / 10_000, i + 1);
      const outflow = baseOut * (1 + changeBps / 10_000);
      const extra = oneOffs.filter((o) => o.month === k).reduce((s, o) => s + Number(o.amountMinor), 0);
      balance += inflow - outflow + extra;
      if (balance < 0 && !runOutMonth) runOutMonth = k;
      return { month: k, inflow: BigInt(Math.round(inflow)), outflow: BigInt(Math.round(outflow)), oneOff: BigInt(Math.round(extra)), balance: BigInt(Math.round(balance)) };
    });
    return { points, runOutMonth: runOutMonth as string | null, endBalance: points.at(-1)?.balance ?? cash };
  };
  return {
    startingCash: cash,
    baseline: { inflow: BigInt(Math.round(baseIn)), outflow: BigInt(Math.round(baseOut)) },
    months: keys,
    base: project(0, 0, [], 12),
    scenarios: scenarios.map((s) => ({ ...s, oneOffs: s.oneOffs as unknown as { month: string; amountMinor: string; label: string }[], ...project(s.revenueGrowthBps, s.expenseChangeBps, s.oneOffs as unknown as { month: string; amountMinor: string }[], s.months) })),
  };
}

export async function cashFlowOverview(ctx: RequestContext, organizationId: string, companyId: string, range: DateRange, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const client = db();
  const [series, forecast, burn, cash] = await Promise.all([cashByMonth(client, companyId, range), cashForecast(client, companyId, 6, now), burnRate(client, companyId, now), cashBalance(client, companyId)]);
  return { series, forecast, burn, cash, runwayMonths: burn.netBurn > 0n ? Number((cash * 10n) / burn.netBurn) / 10 : null };
}

// ───────────── Reports ─────────────

export const REPORTS = ["pnl", "balance", "cashflow", "budget", "revenue", "expenses"] as const;
export type ReportKey = (typeof REPORTS)[number];

export async function profitAndLossReport(ctx: RequestContext, organizationId: string, companyId: string, range: DateRange) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  await ensureFinanceSetup(db(), organizationId, companyId);
  const [accounts, totals] = await Promise.all([db().ledgerAccount.findMany({ where: { companyId, type: { in: ["INCOME", "EXPENSE"] } }, orderBy: { code: "asc" } }), ledgerTotals(db(), companyId, range)]);
  const rows = accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, amountMinor: a.type === "INCOME" ? -(totals.get(a.id) ?? 0n) : (totals.get(a.id) ?? 0n) })).filter((r) => r.amountMinor !== 0n);
  const income = rows.filter((r) => r.type === "INCOME");
  const expense = rows.filter((r) => r.type === "EXPENSE");
  const totalIncome = income.reduce((s, r) => s + r.amountMinor, 0n);
  const totalExpense = expense.reduce((s, r) => s + r.amountMinor, 0n);
  return { income, expense, totalIncome, totalExpense, net: totalIncome - totalExpense };
}

export async function balanceSheetReport(ctx: RequestContext, organizationId: string, companyId: string, asOf: Date) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  await ensureFinanceSetup(db(), organizationId, companyId);
  const to = addDays(asOf, 1);
  const [accounts, totals] = await Promise.all([db().ledgerAccount.findMany({ where: { companyId }, orderBy: { code: "asc" } }), ledgerTotals(db(), companyId, { to })]);
  const section = (type: "ASSET" | "LIABILITY" | "EQUITY") =>
    accounts
      .filter((a) => a.type === type)
      .map((a) => ({ id: a.id, code: a.code, name: a.name, amountMinor: type === "ASSET" ? (totals.get(a.id) ?? 0n) : -(totals.get(a.id) ?? 0n) }))
      .filter((r) => r.amountMinor !== 0n);
  const earnings = accounts.filter((a) => a.type === "INCOME" || a.type === "EXPENSE").reduce((s, a) => s - (totals.get(a.id) ?? 0n), 0n);
  const assets = section("ASSET");
  const liabilities = section("LIABILITY");
  const equity = section("EQUITY");
  const totalAssets = assets.reduce((s, r) => s + r.amountMinor, 0n);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amountMinor, 0n);
  const totalEquity = equity.reduce((s, r) => s + r.amountMinor, 0n) + earnings;
  return { asOf, assets, liabilities, equity, earnings, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
}

/** Direct-method cash flow statement from journal entries that touch cash/bank/card ledger accounts. */
export async function cashFlowStatement(ctx: RequestContext, organizationId: string, companyId: string, range: DateRange) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  await ensureFinanceSetup(db(), organizationId, companyId);
  const fin = await db().financeAccount.findMany({ where: { companyId }, select: { ledgerAccountId: true } });
  const sys = await db().ledgerAccount.findMany({ where: { companyId, systemKey: { in: ["cash", "bank"] } }, select: { id: true } });
  const cashIds = new Set([...fin.map((f) => f.ledgerAccountId), ...sys.map((s) => s.id)]);
  const entries = await db().journalEntry.findMany({
    where: { companyId, status: "POSTED", date: { gte: range.from, lt: range.to }, lines: { some: { ledgerAccountId: { in: [...cashIds] } } } },
    include: { lines: { include: { ledgerAccount: { select: { code: true, name: true, type: true, systemKey: true } } } } },
  });
  const groups = { operating: new Map<string, bigint>(), investing: new Map<string, bigint>(), financing: new Map<string, bigint>() };
  for (const e of entries) {
    const cashDelta = e.lines.filter((l) => cashIds.has(l.ledgerAccountId)).reduce((s, l) => s + l.debitMinor - l.creditMinor, 0n);
    if (cashDelta === 0n) continue;
    const others = e.lines.filter((l) => !cashIds.has(l.ledgerAccountId));
    if (!others.length) continue;
    // Allocate the cash movement to the counterpart lines in proportion to their size.
    const totalOther = others.reduce((s, l) => s + (l.debitMinor + l.creditMinor), 0n);
    let allocated = 0n;
    others.forEach((l, i) => {
      // Last line takes the rounding remainder so the sections add up to the cash movement exactly.
      const share = i === others.length - 1 ? cashDelta - allocated : (cashDelta * (l.debitMinor + l.creditMinor)) / (totalOther || 1n);
      allocated += share;
      const a = l.ledgerAccount;
      const group = a.type === "EQUITY" || a.code.startsWith("25") || a.systemKey === "loans" ? "financing" : a.code.startsWith("15") || a.systemKey === "fixed_assets" ? "investing" : "operating";
      const label = `${a.code} ${a.name}`;
      groups[group].set(label, (groups[group].get(label) ?? 0n) + share);
    });
  }
  const toRows = (m: Map<string, bigint>) => [...m].map(([label, amountMinor]) => ({ label, amountMinor })).sort((a, b) => a.label.localeCompare(b.label));
  const [opening, closing] = await Promise.all([ledgerTotals(db(), companyId, { to: range.from }), ledgerTotals(db(), companyId, { to: range.to })]);
  const sumCash = (m: Map<string, bigint>) => [...cashIds].reduce((s, id) => s + (m.get(id) ?? 0n), 0n);
  const sections = { operating: toRows(groups.operating), investing: toRows(groups.investing), financing: toRows(groups.financing) };
  const total = (rows: { amountMinor: bigint }[]) => rows.reduce((s, r) => s + r.amountMinor, 0n);
  return {
    ...sections,
    totals: { operating: total(sections.operating), investing: total(sections.investing), financing: total(sections.financing) },
    openingCash: sumCash(opening),
    closingCash: sumCash(closing),
  };
}

export async function revenueReport(ctx: RequestContext, organizationId: string, companyId: string, range: DateRange) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const invoices = await db().invoice.findMany({
    where: { organizationId, companyId, status: { notIn: ["DRAFT", "VOID"] }, issueDate: { gte: range.from, lt: range.to } },
    select: { issueDate: true, totalMinor: true, taxMinor: true, paidMinor: true, accountId: true, account: { select: { name: true } } },
  });
  const keys = months(range.from, range.to);
  const byMonth = new Map(keys.map((k) => [k, 0n]));
  const byCustomer = new Map<string, { id: string; name: string; netMinor: bigint; paidMinor: bigint; count: number }>();
  for (const i of invoices) {
    const net = i.totalMinor - i.taxMinor;
    const k = monthKey(i.issueDate);
    byMonth.set(k, (byMonth.get(k) ?? 0n) + net);
    const c = byCustomer.get(i.accountId) ?? { id: i.accountId, name: i.account.name, netMinor: 0n, paidMinor: 0n, count: 0 };
    c.netMinor += net;
    c.paidMinor += i.paidMinor;
    c.count++;
    byCustomer.set(i.accountId, c);
  }
  return { byMonth: [...byMonth].map(([month, netMinor]) => ({ month, netMinor })), byCustomer: [...byCustomer.values()].sort((a, b) => (b.netMinor > a.netMinor ? 1 : -1)), total: invoices.reduce((s, i) => s + i.totalMinor - i.taxMinor, 0n) };
}

export async function expenseReport(ctx: RequestContext, organizationId: string, companyId: string, range: DateRange) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const where = { organizationId, companyId, type: "EXPENSE" as const, date: { gte: range.from, lt: range.to } };
  const [byCat, byVendor, byDep] = await Promise.all([
    db().financeTransaction.groupBy({ by: ["categoryId"], where, _sum: { amountMinor: true }, _count: true }),
    db().financeTransaction.groupBy({ by: ["accountId"], where, _sum: { amountMinor: true }, _count: true }),
    db().financeTransaction.groupBy({ by: ["departmentId"], where, _sum: { amountMinor: true }, _count: true }),
  ]);
  const ids = (xs: (string | null)[]) => xs.filter((x): x is string => !!x);
  const [cats, vendors, deps] = await Promise.all([
    db().financeCategory.findMany({ where: { id: { in: ids(byCat.map((r) => r.categoryId)) } }, select: { id: true, name: true } }),
    db().account.findMany({ where: { id: { in: ids(byVendor.map((r) => r.accountId)) } }, select: { id: true, name: true } }),
    db().department.findMany({ where: { id: { in: ids(byDep.map((r) => r.departmentId)) } }, select: { id: true, name: true } }),
  ]);
  const named = (rows: { key: string | null; sum: bigint; count: number }[], names: { id: string; name: string }[]) => {
    const m = new Map(names.map((n) => [n.id, n.name]));
    return rows.map((r) => ({ id: r.key, name: r.key ? (m.get(r.key) ?? "—") : null, amountMinor: r.sum, count: r.count })).sort((a, b) => (b.amountMinor > a.amountMinor ? 1 : -1));
  };
  const total = byCat.reduce((s, r) => s + (r._sum.amountMinor ?? 0n), 0n);
  return {
    total,
    byCategory: named(byCat.map((r) => ({ key: r.categoryId, sum: r._sum.amountMinor ?? 0n, count: r._count })), cats),
    byVendor: named(byVendor.map((r) => ({ key: r.accountId, sum: r._sum.amountMinor ?? 0n, count: r._count })), vendors),
    byDepartment: named(byDep.map((r) => ({ key: r.departmentId, sum: r._sum.amountMinor ?? 0n, count: r._count })), deps),
  };
}

/** CSV export of any report for the range (balance sheet: as of the range end). Labels are English column keys. */
export async function reportCsv(ctx: RequestContext, organizationId: string, companyId: string, report: ReportKey, range: DateRange) {
  const company = await companyInfo(db(), organizationId, companyId);
  const m = (v: bigint) => fromMinor(v, company.baseCurrency);
  switch (report) {
    case "pnl": {
      const r = await profitAndLossReport(ctx, organizationId, companyId, range);
      return toCsv([["section", "code", "account", "amount"], ...r.income.map((x) => ["income", x.code, x.name, m(x.amountMinor)]), ["income", "", "Total income", m(r.totalIncome)], ...r.expense.map((x) => ["expense", x.code, x.name, m(x.amountMinor)]), ["expense", "", "Total expenses", m(r.totalExpense)], ["net", "", "Net profit", m(r.net)]]);
    }
    case "balance": {
      const r = await balanceSheetReport(ctx, organizationId, companyId, addDays(range.to, -1));
      return toCsv([
        ["section", "code", "account", "amount"],
        ...r.assets.map((x) => ["assets", x.code, x.name, m(x.amountMinor)]),
        ["assets", "", "Total assets", m(r.totalAssets)],
        ...r.liabilities.map((x) => ["liabilities", x.code, x.name, m(x.amountMinor)]),
        ["liabilities", "", "Total liabilities", m(r.totalLiabilities)],
        ...r.equity.map((x) => ["equity", x.code, x.name, m(x.amountMinor)]),
        ["equity", "", "Current earnings", m(r.earnings)],
        ["equity", "", "Total equity", m(r.totalEquity)],
      ]);
    }
    case "cashflow": {
      const r = await cashFlowStatement(ctx, organizationId, companyId, range);
      return toCsv([
        ["section", "line", "amount"],
        ["", "Opening cash", m(r.openingCash)],
        ...(["operating", "investing", "financing"] as const).flatMap((s) => [...r[s].map((x) => [s, x.label, m(x.amountMinor)]), [s, `Net ${s}`, m(r.totals[s])]]),
        ["", "Closing cash", m(r.closingCash)],
      ]);
    }
    case "budget": {
      const r = await budgetVsActual(ctx, organizationId, companyId, range);
      return toCsv([["budget", "category", "cost_center", "period_start", "period_end", "budget", "actual", "remaining", "used_pct"], ...r.map((b) => [b.name, b.category?.name ?? "", b.department?.name ?? "", dayString(b.periodStart), dayString(b.periodEnd), m(b.amountMinor), m(b.actualMinor), m(b.remainingMinor), b.usedPct])]);
    }
    case "revenue": {
      const r = await revenueReport(ctx, organizationId, companyId, range);
      return toCsv([["group", "key", "net_revenue", "paid", "invoices"], ...r.byMonth.map((x) => ["month", x.month, m(x.netMinor), "", ""]), ...r.byCustomer.map((x) => ["customer", x.name, m(x.netMinor), m(x.paidMinor), x.count])]);
    }
    case "expenses": {
      const r = await expenseReport(ctx, organizationId, companyId, range);
      return toCsv([
        ["group", "name", "amount", "transactions"],
        ...r.byCategory.map((x) => ["category", x.name ?? "Uncategorized", m(x.amountMinor), x.count]),
        ...r.byVendor.map((x) => ["vendor", x.name ?? "No vendor", m(x.amountMinor), x.count]),
        ...r.byDepartment.map((x) => ["cost_center", x.name ?? "No cost center", m(x.amountMinor), x.count]),
      ]);
    }
  }
}

export const parseReport = (v: string | undefined): ReportKey => ((REPORTS as readonly string[]).includes(v ?? "") ? (v as ReportKey) : "pnl");

