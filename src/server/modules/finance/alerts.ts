import type { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { authorize, monthKey, todayUtc } from "./common";
import { burnRate, cashBalance, cashForecast } from "./analytics";
import { balanceOf, OPEN_STATUSES } from "./billing";
import { billBalance } from "./payables";
import { OPEN_BILL_STATUSES } from "./spend";
import { budgetVsActual } from "./transactions";

/**
 * Financial alerts.
 * - Worker (hourly, each alert at most once per company and month): low cash runway (< 6 months, critical < 3) and a
 *   forecast month where cash drops below zero. Overdue invoices/bills and budget thresholds have their own jobs
 *   (billing.markOverdueInvoices, payables.notifyOverdueBills, budgets.runBudgetAlerts).
 * - Alert center: everything that needs attention right now, computed live from the books, plus the history.
 */

export const RUNWAY_LOW_MONTHS = 6;
export const RUNWAY_CRITICAL_MONTHS = 3;

type AlertKind = "runway_low" | "runway_critical" | "cash_negative_forecast";

async function sendOnce(organizationId: string, companyId: string, kind: AlertKind, periodKey: string, data: Record<string, unknown>, title: string) {
  return transaction(async (tx) => {
    const { count } = await tx.financeAlertLog.createMany({ data: [{ organizationId, companyId, kind, periodKey, data: data as Prisma.InputJsonValue }], skipDuplicates: true });
    if (!count) return 0;
    const recipients = await usersWithPermission(tx, organizationId, companyId, "finance.read");
    await notifyUsers(tx, organizationId, recipients, `finance.${kind}`, { companyId, title, href: "/finance/alerts" });
    await writeAudit(tx, systemContext(), { category: "TENANT", organizationId, action: `finance.alert.${kind}`, resourceType: "company", resourceId: companyId, newValue: data as Prisma.InputJsonValue });
    return 1;
  });
}

/** Worker: runway and negative-cash-forecast alerts for every company that uses Finance. */
export async function runCashAlerts(now = new Date()): Promise<number> {
  const companies = await db().financeSettings.findMany({ select: { organizationId: true, companyId: true }, take: 5000 });
  const period = monthKey(todayUtc(now));
  let sent = 0;
  for (const c of companies) {
    try {
      const client = db();
      const hasActivity = await client.financeTransaction.findFirst({ where: { companyId: c.companyId }, select: { id: true } });
      if (!hasActivity) continue;
      const [cash, burn, forecast, company] = await Promise.all([
        cashBalance(client, c.companyId),
        burnRate(client, c.companyId, now),
        cashForecast(client, c.companyId, 6, now),
        client.company.findUnique({ where: { id: c.companyId }, select: { name: true, baseCurrency: true } }),
      ]);
      const name = company?.name ?? "";
      if (burn.netBurn > 0n) {
        const runway = Number((cash * 10n) / burn.netBurn) / 10;
        const data = { runwayMonths: runway, cashMinor: cash.toString(), netBurnMinor: burn.netBurn.toString(), currency: company?.baseCurrency };
        if (runway < RUNWAY_CRITICAL_MONTHS) sent += await sendOnce(c.organizationId, c.companyId, "runway_critical", period, data, `${name} · ${runway}`);
        else if (runway < RUNWAY_LOW_MONTHS) sent += await sendOnce(c.organizationId, c.companyId, "runway_low", period, data, `${name} · ${runway}`);
      }
      const negative = forecast.months.find((m) => m.balance < 0n);
      if (negative) {
        sent += await sendOnce(c.organizationId, c.companyId, "cash_negative_forecast", period, { month: negative.month, balanceMinor: negative.balance.toString(), currency: company?.baseCurrency }, `${name} · ${negative.month}`);
      }
    } catch (err) {
      logger.warn({ err, companyId: c.companyId }, "finance cash alert failed");
    }
  }
  return sent;
}

export type AlertLevel = "critical" | "warning" | "info";

/** Live alert center (finance.read). */
export async function financeAlertCenter(ctx: RequestContext, organizationId: string, companyId: string, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const client = db();
  const today = todayUtc(now);
  const [overdueInvoices, overdueBills, budgets, cash, burn, forecast, history] = await Promise.all([
    client.invoice.findMany({
      where: { organizationId, companyId, status: { in: OPEN_STATUSES }, dueDate: { lt: today } },
      orderBy: { dueDate: "asc" },
      take: 50,
      select: { id: true, number: true, dueDate: true, totalMinor: true, paidMinor: true, creditedMinor: true, currency: true, account: { select: { name: true } } },
    }),
    client.financeBill.findMany({
      where: { organizationId, companyId, status: { in: OPEN_BILL_STATUSES }, dueDate: { lt: today } },
      orderBy: { dueDate: "asc" },
      take: 50,
      select: { id: true, number: true, dueDate: true, totalMinor: true, paidMinor: true, currency: true, vendor: { select: { name: true } } },
    }),
    budgetVsActual(ctx, organizationId, companyId, { from: today, to: new Date(today.getTime() + 86_400_000) }),
    cashBalance(client, companyId),
    burnRate(client, companyId, now),
    cashForecast(client, companyId, 6, now),
    client.financeAlertLog.findMany({ where: { organizationId, companyId }, orderBy: { sentAt: "desc" }, take: 20 }),
  ]);
  const runwayMonths = burn.netBurn > 0n ? Number((cash * 10n) / burn.netBurn) / 10 : null;
  const runwayLevel: AlertLevel | null = runwayMonths === null ? null : runwayMonths < RUNWAY_CRITICAL_MONTHS ? "critical" : runwayMonths < RUNWAY_LOW_MONTHS ? "warning" : null;
  const negative = forecast.months.find((m) => m.balance < 0n) ?? null;
  const invoices = overdueInvoices.map((i) => ({ ...i, balanceMinor: balanceOf(i), daysLate: Math.floor((today.getTime() - i.dueDate.getTime()) / 86_400_000) }));
  const bills = overdueBills.map((b) => ({ ...b, balanceMinor: billBalance(b), daysLate: Math.floor((today.getTime() - b.dueDate.getTime()) / 86_400_000) }));
  const overBudget = budgets.filter((b) => b.usedPct >= 80).sort((a, b) => b.usedPct - a.usedPct);
  const count = (runwayLevel ? 1 : 0) + (negative ? 1 : 0) + (invoices.length ? 1 : 0) + (bills.length ? 1 : 0) + overBudget.length;
  return {
    count,
    runway: { months: runwayMonths, level: runwayLevel, cash, netBurn: burn.netBurn },
    negative,
    invoices,
    invoicesTotal: invoices.reduce((s, i) => s + i.balanceMinor, 0n),
    bills,
    billsTotal: bills.reduce((s, b) => s + b.balanceMinor, 0n),
    overBudget,
    history,
  };
}
