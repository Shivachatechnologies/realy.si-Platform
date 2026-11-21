import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { departmentHeadUser } from "./approval-rules";
import { addDays, addMonths, authorize, companyInfo, dayString, isUuid, param, todayUtc, type DateRange } from "./common";
import { POSTED_BILL_STATUSES, spendActual } from "./spend";

export type BudgetPeriod = "month" | "quarter";

/** ?period=month|quarter&at=YYYY-MM → the calendar month or quarter containing `at` (default: now). */
export function parseBudgetWindow(raw: Record<string, string | string[] | undefined>, now = new Date()): DateRange & { period: BudgetPeriod; at: string; label: string } {
  const period: BudgetPeriod = param(raw, "period") === "quarter" ? "quarter" : "month";
  const at = param(raw, "at");
  const m = at && /^\d{4}-(0[1-9]|1[0-2])$/.test(at) ? at : dayString(now).slice(0, 7);
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const startMonth = period === "quarter" ? Math.floor((mo - 1) / 3) * 3 : mo - 1;
  const from = new Date(Date.UTC(y, startMonth, 1));
  const to = addMonths(from, period === "quarter" ? 3 : 1);
  return { from, to, period, at: m, label: period === "quarter" ? `${y}-Q${startMonth / 3 + 1}` : m };
}

const DAY = 86_400_000;
/** The part of a budget that falls inside the window, pro rata by days. */
function proratedBudget(b: { periodStart: Date; periodEnd: Date; amountMinor: bigint }, w: DateRange) {
  const start = Math.max(b.periodStart.getTime(), w.from.getTime());
  const end = Math.min(addDays(b.periodEnd, 1).getTime(), w.to.getTime());
  if (end <= start) return 0n;
  const total = Math.round((addDays(b.periodEnd, 1).getTime() - b.periodStart.getTime()) / DAY);
  const inside = Math.round((end - start) / DAY);
  return inside >= total ? b.amountMinor : (b.amountMinor * BigInt(inside)) / BigInt(Math.max(total, 1));
}

/** Budget vs actual per department (cost center) for a month or a quarter. Actual = expenses + posted bill lines. */
export async function departmentBudgets(ctx: RequestContext, organizationId: string, companyId: string, w: DateRange) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const [departments, budgets] = await Promise.all([
    db().department.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, costCenterCode: true, head: { select: { id: true, firstName: true, lastName: true, userId: true } } } }),
    db().financeBudget.findMany({ where: { organizationId, companyId, departmentId: { not: null }, periodStart: { lt: w.to }, periodEnd: { gte: w.from } }, select: { departmentId: true, periodStart: true, periodEnd: true, amountMinor: true } }),
  ]);
  const rows = [];
  for (const d of departments) {
    const budgetMinor = budgets.filter((b) => b.departmentId === d.id).reduce((s, b) => s + proratedBudget(b, w), 0n);
    const spend = await spendActual(db(), companyId, { from: w.from, to: w.to, departmentId: d.id });
    if (budgetMinor === 0n && spend.totalMinor === 0n) continue;
    rows.push({
      ...d,
      headName: d.head ? [d.head.firstName, d.head.lastName].filter(Boolean).join(" ") : null,
      budgetMinor,
      ...spend,
      remainingMinor: budgetMinor - spend.totalMinor,
      usedPct: budgetMinor > 0n ? Number((spend.totalMinor * 10_000n) / budgetMinor) / 100 : null,
    });
  }
  const totalBudget = rows.reduce((s, r) => s + r.budgetMinor, 0n);
  const totalActual = rows.reduce((s, r) => s + r.totalMinor, 0n);
  return { rows, totalBudget, totalActual, usedPct: totalBudget > 0n ? Number((totalActual * 10_000n) / totalBudget) / 100 : null };
}

/** Drilldown of one department's spend in a window: expense transactions and posted bill lines. */
export async function departmentSpendDetail(ctx: RequestContext, organizationId: string, companyId: string, departmentId: string, w: DateRange) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const department = isUuid(departmentId) ? await db().department.findFirst({ where: { id: departmentId, organizationId, companyId }, select: { id: true, name: true, costCenterCode: true, head: { select: { firstName: true, lastName: true } } } }) : null;
  if (!department) throw notFound("Cost center");
  const [transactions, billLines, budgets, spend] = await Promise.all([
    db().financeTransaction.findMany({
      where: { companyId, type: "EXPENSE", billPaymentId: null, departmentId, date: { gte: w.from, lt: w.to } },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 500,
      include: { category: { select: { name: true } }, account: { select: { name: true } } },
    }),
    db().financeBillLine.findMany({
      where: { companyId, departmentId, bill: { status: { in: POSTED_BILL_STATUSES }, issueDate: { gte: w.from, lt: w.to } } },
      orderBy: { bill: { issueDate: "desc" } },
      take: 500,
      include: { category: { select: { name: true } }, bill: { select: { id: true, number: true, issueDate: true, vendor: { select: { name: true } } } } },
    }),
    db().financeBudget.findMany({ where: { companyId, departmentId, periodStart: { lt: w.to }, periodEnd: { gte: w.from } }, include: { category: { select: { name: true } } }, orderBy: { periodStart: "asc" } }),
    spendActual(db(), companyId, { from: w.from, to: w.to, departmentId }),
  ]);
  const budgetMinor = budgets.reduce((s, b) => s + proratedBudget(b, w), 0n);
  return { department, transactions, billLines, budgets, budgetMinor, ...spend };
}

/** Thresholds (percent used) that trigger a budget-owner notification, once per budget and period. */
export const BUDGET_THRESHOLDS = [80, 100] as const;

/**
 * Worker: for every budget whose period includes today, notify its owner (the department head's user, or finance
 * managers when there is none) when spend crosses 80% and 100%.
 */
export async function runBudgetAlerts(now = new Date()): Promise<number> {
  const today = todayUtc(now);
  const budgets = await db().financeBudget.findMany({ where: { periodStart: { lte: today }, periodEnd: { gte: today }, amountMinor: { gt: 0n } }, take: 2000 });
  let sent = 0;
  for (const b of budgets) {
    try {
      const spend = await spendActual(db(), b.companyId, { from: b.periodStart, to: addDays(b.periodEnd, 1), categoryId: b.categoryId, departmentId: b.departmentId });
      const pct = Number((spend.totalMinor * 100n) / b.amountMinor);
      const reached = BUDGET_THRESHOLDS.filter((t) => pct >= t);
      if (!reached.length) continue;
      const periodKey = dayString(b.periodStart);
      sent += await transaction(async (tx) => {
        const existing = await tx.financeBudgetAlert.findMany({ where: { budgetId: b.id, periodKey }, select: { threshold: true } });
        const fresh = reached.filter((t) => !existing.some((e) => e.threshold === t));
        if (!fresh.length) return 0;
        const { count } = await tx.financeBudgetAlert.createMany({ data: fresh.map((threshold) => ({ organizationId: b.organizationId, companyId: b.companyId, budgetId: b.id, threshold, periodKey })), skipDuplicates: true });
        if (!count) return 0;
        const top = Math.max(...fresh);
        const head = await departmentHeadUser(tx, b.companyId, b.departmentId);
        const recipients = head ? [head] : await usersWithPermission(tx, b.organizationId, b.companyId, "finance.manage");
        const currency = (await companyInfo(tx, b.organizationId, b.companyId)).baseCurrency;
        await notifyUsers(tx, b.organizationId, recipients, top >= 100 ? "finance.budget_exceeded" : "finance.budget_warning", { companyId: b.companyId, title: b.name, href: b.departmentId ? `/finance/budgets/${b.departmentId}` : "/finance/budgets" });
        await writeAudit(tx, systemContext(), { category: "TENANT", organizationId: b.organizationId, action: "finance.budget.threshold", resourceType: "finance_budget", resourceId: b.id, newValue: { threshold: top, actualMinor: spend.totalMinor, amountMinor: b.amountMinor, currency } });
        return 1;
      });
    } catch (err) {
      logger.warn({ err, budgetId: b.id }, "budget alert failed");
    }
  }
  return sent;
}

/** Budget utilization (percent) of the budgets active at `asOf`; null without budgets. No authorization. */
export async function budgetUtilization(companyId: string, asOf: Date) {
  const day = todayUtc(asOf);
  const budgets = await db().financeBudget.findMany({ where: { companyId, periodStart: { lte: day }, periodEnd: { gte: day }, amountMinor: { gt: 0n } } });
  let budget = 0n;
  let actual = 0n;
  for (const b of budgets) {
    budget += b.amountMinor;
    actual += (await spendActual(db(), companyId, { from: b.periodStart, to: addDays(b.periodEnd, 1), categoryId: b.categoryId, departmentId: b.departmentId })).totalMinor;
  }
  return budget > 0n ? { pct: Number((actual * 10_000n) / budget) / 100, budget, actual, count: budgets.length } : null;
}
