import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { createTask, listSubjectTasks } from "@/server/modules/agents/service";
import { can } from "@/server/modules/rbac/service";
import { departmentManagers, runManagerTask } from "@/server/modules/cockpit/department-manager";
import { addDays, addMonths, authorize, companyInfo, dayString, monthKey, monthStart, todayUtc } from "./common";
import { cashForecast } from "./analytics";
import { budgetVsActual, updateTransaction } from "./transactions";

/**
 * The AI Finance Manager's desk: revenue forecast (contracted + invoiced + weighted pipeline, clearly labelled),
 * expense categorisation suggestions from the company's own history, budget-vs-actual explanations from the real
 * postings, and the monthly finance memo written by the ai_cfo (scheduled when an AI CFO is hired, or on demand).
 */

// ───────────── Revenue forecast ─────────────

export interface RevenueForecastMonth {
  month: string;
  /** Active recurring invoices issued in the month (contracted). */
  recurringMinor: bigint;
  /** Open invoices falling due in the month (already invoiced; overdue ones count in the first month). */
  receivablesMinor: bigint;
  /** Open CRM deals expected to close in the month × probability (projection). */
  pipelineMinor: bigint;
  totalMinor: bigint;
}

export async function revenueForecast(ctx: RequestContext, organizationId: string, companyId: string, months = 6) {
  const chain = await authorize(ctx, organizationId, companyId, "finance.read");
  const n = Math.min(12, Math.max(1, Math.trunc(months)));
  const { baseCurrency } = await companyInfo(db(), organizationId, companyId);
  const cash = await cashForecast(db(), companyId, n);
  // The pipeline is read from the CRM only when the viewer may see sales data; otherwise it is reported as unavailable.
  const pipelineVisible = await can(ctx, "sales.read", chain);
  // Read-only use of the CRM forecast, loaded lazily so the worker's finance jobs don't pull in the CRM module graph.
  const pipeline = pipelineVisible
    ? await import("@/server/modules/crm/sales").then((m) => m.salesForecast(ctx, organizationId, companyId, { months: n + 1 })).catch(() => null)
    : null;
  const pipe = new Map((pipeline?.byMonth ?? []).map((m) => [m.month, m.weightedMinor]));
  const rows: RevenueForecastMonth[] = cash.months.map((m) => {
    const pipelineMinor = pipe.get(m.month) ?? 0n;
    return { month: m.month, recurringMinor: m.recurringIncome, receivablesMinor: m.receivables, pipelineMinor, totalMinor: m.recurringIncome + m.receivables + pipelineMinor };
  });
  const total = (f: (r: RevenueForecastMonth) => bigint) => rows.reduce((s, r) => s + f(r), 0n);
  return {
    currency: baseCurrency,
    months: rows,
    totals: { recurringMinor: total((r) => r.recurringMinor), receivablesMinor: total((r) => r.receivablesMinor), pipelineMinor: total((r) => r.pipelineMinor), totalMinor: total((r) => r.totalMinor) },
    pipeline: pipelineVisible ? (pipeline ? "included" : "unavailable") : "no_access",
    openDeals: pipeline ? pipeline.byMonth.reduce((s, m) => s + m.count, 0) : null,
  } as const;
}

// ───────────── Expense categorisation suggestions ─────────────

const STOP = new Set(["the", "and", "for", "from", "with", "payment", "invoice", "inv", "ltd", "llc", "gmbh", "inc", "card", "purchase", "der", "die", "und"]);
const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));

export interface CategorySuggestion {
  transactionId: string;
  date: string;
  description: string;
  amountMinor: bigint;
  currency: string;
  vendor: string | null;
  categoryId: string;
  categoryName: string;
  /** "vendor": same vendor's previous expenses; "words": words shared with previously categorised expenses. */
  basis: "vendor" | "words";
  /** Share of the matching history that used this category (0–100). */
  confidence: number;
  samples: number;
}

/**
 * Uncategorised expenses of the last `days` days with a suggested category learnt from the company's own categorised
 * expenses (last 12 months): the vendor's usual category first, else the category whose descriptions share most words.
 */
export async function expenseCategorySuggestions(ctx: RequestContext, organizationId: string, companyId: string, opts: { days?: number; take?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const now = todayUtc();
  const since = addDays(now, -(opts.days ?? 120));
  const [open, history, categories] = await Promise.all([
    db().financeTransaction.findMany({
      where: { organizationId, companyId, type: "EXPENSE", categoryId: null, billPaymentId: null, paymentId: null, date: { gte: since } },
      orderBy: { date: "desc" },
      take: 200,
      select: { id: true, date: true, description: true, amountMinor: true, currency: true, accountId: true, account: { select: { name: true } } },
    }),
    db().financeTransaction.findMany({
      where: { organizationId, companyId, type: "EXPENSE", categoryId: { not: null }, date: { gte: addMonths(now, -12) } },
      orderBy: { date: "desc" },
      take: 3000,
      select: { description: true, accountId: true, categoryId: true },
    }),
    db().financeCategory.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true, name: true } }),
  ]);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const byVendor = new Map<string, Map<string, number>>();
  const byWord = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, k: string, cat: string) => {
    const inner = m.get(k) ?? new Map<string, number>();
    inner.set(cat, (inner.get(cat) ?? 0) + 1);
    m.set(k, inner);
  };
  for (const h of history) {
    if (!h.categoryId || !names.has(h.categoryId)) continue;
    if (h.accountId) bump(byVendor, h.accountId, h.categoryId);
    for (const w of new Set(tokens(h.description))) bump(byWord, w, h.categoryId);
  }
  const best = (m: Map<string, number>) => {
    let top: [string, number] | null = null;
    let all = 0;
    for (const [k, v] of m) {
      all += v;
      if (!top || v > top[1]) top = [k, v];
    }
    return top ? { categoryId: top[0], hits: top[1], all } : null;
  };
  const out: CategorySuggestion[] = [];
  for (const t of open) {
    let pick: { categoryId: string; hits: number; all: number; basis: "vendor" | "words" } | null = null;
    const v = t.accountId ? byVendor.get(t.accountId) : undefined;
    const vb = v ? best(v) : null;
    if (vb && vb.hits >= 2) pick = { ...vb, basis: "vendor" };
    if (!pick) {
      const score = new Map<string, number>();
      for (const w of new Set(tokens(t.description))) for (const [cat, c] of byWord.get(w) ?? []) score.set(cat, (score.get(cat) ?? 0) + c);
      const wb = best(score);
      if (wb && wb.hits >= 2) pick = { ...wb, basis: "words" };
    }
    if (!pick) continue;
    out.push({
      transactionId: t.id,
      date: dayString(t.date),
      description: t.description,
      amountMinor: t.amountMinor,
      currency: t.currency,
      vendor: t.account?.name ?? null,
      categoryId: pick.categoryId,
      categoryName: names.get(pick.categoryId) ?? "",
      basis: pick.basis,
      confidence: Math.round((pick.hits / Math.max(1, pick.all)) * 100),
      samples: pick.hits,
    });
    if (out.length >= (opts.take ?? 25)) break;
  }
  return { suggestions: out, uncategorised: open.length };
}

export const applyCategoryInput = z.object({ categoryId: z.string().uuid() });

/** Apply a suggested category (finance.manage; the transaction's ledger posting is updated by updateTransaction). */
export async function applyExpenseCategory(ctx: RequestContext, organizationId: string, companyId: string, transactionId: string, raw: z.input<typeof applyCategoryInput>) {
  const { categoryId } = applyCategoryInput.parse(raw);
  return updateTransaction(ctx, organizationId, companyId, transactionId, { categoryId });
}

// ───────────── Budget vs actual explanations ─────────────

export interface VarianceDriver {
  description: string;
  vendor: string | null;
  date: string;
  amountMinor: bigint;
}

/**
 * For each budget of the current month (or the given window) the variance and a plain explanation of what drove it: the
 * largest postings in its scope, the change against the previous period of the same length, and the run-rate projection
 * to the end of the period (labelled as a projection).
 */
export async function budgetVarianceExplanations(ctx: RequestContext, organizationId: string, companyId: string, window?: { from: Date; to: Date }) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const now = todayUtc();
  const w = window ?? { from: monthStart(now), to: addMonths(monthStart(now), 1) };
  const budgets = await budgetVsActual(ctx, organizationId, companyId, w);
  const out = [];
  for (const b of budgets.slice(0, 30)) {
    const from = b.periodStart;
    const to = addDays(b.periodEnd, 1);
    const scope = { ...(b.categoryId ? { categoryId: b.categoryId } : {}), ...(b.departmentId ? { departmentId: b.departmentId } : {}) };
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);
    const [top, prev] = await Promise.all([
      db().financeTransaction.findMany({
        where: { companyId, type: "EXPENSE", billPaymentId: null, date: { gte: from, lt: to }, ...scope },
        orderBy: { amountMinor: "desc" },
        take: 3,
        select: { description: true, date: true, amountMinor: true, account: { select: { name: true } } },
      }),
      db().financeTransaction.aggregate({ where: { companyId, type: "EXPENSE", billPaymentId: null, date: { gte: prevFrom, lt: from }, ...scope }, _sum: { amountMinor: true } }),
    ]);
    const elapsed = Math.min(1, Math.max(0, (Math.min(now.getTime() + 86_400_000, to.getTime()) - from.getTime()) / span));
    const projectedMinor = elapsed > 0 && elapsed < 1 ? BigInt(Math.round(Number(b.actualMinor) / elapsed)) : b.actualMinor;
    const status: "over" | "trending_over" | "watch" | "on_track" = b.actualMinor > b.amountMinor ? "over" : projectedMinor > b.amountMinor ? "trending_over" : b.usedPct >= 80 ? "watch" : "on_track";
    out.push({
      id: b.id,
      name: b.name,
      scope: b.category?.name ?? b.department?.name ?? null,
      currency: b.currency,
      budgetMinor: b.amountMinor,
      actualMinor: b.actualMinor,
      varianceMinor: b.amountMinor - b.actualMinor,
      usedPct: b.usedPct,
      previousMinor: prev._sum.amountMinor ?? 0n,
      projectedMinor,
      elapsedPct: Math.round(elapsed * 100),
      status,
      drivers: top.map((t) => ({ description: t.description, vendor: t.account?.name ?? null, date: dayString(t.date), amountMinor: t.amountMinor })) as VarianceDriver[],
    });
  }
  const rank = { over: 0, trending_over: 1, watch: 2, on_track: 3 } as const;
  return out.sort((a, b) => rank[a.status] - rank[b.status]);
}

// ───────────── Monthly finance memo ─────────────

export const MEMO_SUBJECT = "finance_memo";
export const memoInput = z.object({ focus: z.string().trim().max(1000).optional() });

function memoInstructions(month: string, focus?: string) {
  return [
    `Write the monthly finance memo for ${month} for the founder. Use the company's real books only.`,
    "Read first: read_financial_summary (last 3 months and this month), read_cashflow_forecast (6 months), read_revenue_forecast, read_budget_variance, read_financial_alerts, detect_expense_anomalies, read_invoices with status OVERDUE, read_payables and suggest_expense_categories.",
    "Memo structure: (1) Headline — one sentence on the state of the business. (2) P&L — revenue, expenses, net profit vs the previous month, with the numbers. (3) Cash — balance, burn, runway and the 6-month projected low point. (4) Revenue outlook — contracted (recurring), invoiced and weighted pipeline, always labelled as projections. (5) Budgets — which are over or trending over and why (name the postings that drove it). (6) Risks — late payers, unusual expenses, uncategorised spend. (7) Actions — at most five concrete actions for the next 30 days, each with an owner role, a due date and its expected financial effect.",
    "For each action that needs follow-up, propose a task with create_work_task (title starting with \"Finance:\", a due date and a short description with the figures). Tasks take effect only after a person approves them. Categorise expenses only by proposing categorize_expense for suggestions with high confidence.",
    "Never invent figures. If data is missing (no transactions, no budgets, no pipeline access), say so and what to record.",
    focus ? `Additional focus from the requester: ${focus}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function requestFinanceMemo(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof memoInput>) {
  const input = memoInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "finance.read");
  const month = monthKey(todayUtc());
  return createTask(ctx, organizationId, companyId, { profile: "ai_cfo", title: `Finance memo ${month}`, instructions: memoInstructions(month, input.focus), subject: { type: MEMO_SUBJECT, id: companyId } });
}

export async function listMemoTasks(ctx: RequestContext, organizationId: string, companyId: string) {
  return listSubjectTasks(ctx, organizationId, companyId, MEMO_SUBJECT, companyId, 6);
}

/** Job: on the first days of each month, the hired AI CFO of every company writes the memo for the month just closed. */
export async function runMonthlyFinanceMemos(now = new Date()) {
  const start = monthStart(todayUtc(now));
  if (todayUtc(now).getUTCDate() > 3) return 0;
  const month = monthKey(addMonths(start, -1));
  let queued = 0;
  for (const m of await departmentManagers(["ai_cfo"])) {
    const id = await runManagerTask(m, "finance", { title: `Finance memo ${month}`, instructions: memoInstructions(month), subject: { type: MEMO_SUBJECT, id: m.companyId }, since: start });
    if (id) queued++;
  }
  return queued;
}
