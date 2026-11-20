import type { MetricDefinition, MetricRange, MetricScope } from "@/server/core/metrics";
import { db } from "@/server/core/db";
import { addDays } from "./common";
import { burnRate, cashBalance, overdueReceivables, profitAndLossTotals, recurringRevenue } from "./analytics";

const base = { department: "finance", permission: "finance.read" } as const;
/** "Now" for stock metrics: the end of the range (exclusive) or today, whichever is earlier. */
const asOf = (range: MetricRange) => (range.to.getTime() < Date.now() ? range.to : new Date());

/** KPIs of the finance module (see src/server/core/metrics.ts); used by analytics, dashboards and AI briefings. */
export const FINANCE_METRICS: MetricDefinition[] = [
  { ...base, key: "finance.revenue", labelKey: "finance.metrics.revenue", unit: "money", kind: "flow", higherIsBetter: true, href: "/finance/reports?report=pnl", compute: async (s: MetricScope, r) => (await profitAndLossTotals(db(), s.companyId, r)).revenue },
  { ...base, key: "finance.expenses", labelKey: "finance.metrics.expenses", unit: "money", kind: "flow", higherIsBetter: false, href: "/finance/reports?report=expenses", compute: async (s, r) => (await profitAndLossTotals(db(), s.companyId, r)).expenses },
  { ...base, key: "finance.net_profit", labelKey: "finance.metrics.netProfit", unit: "money", kind: "flow", higherIsBetter: true, href: "/finance/reports?report=pnl", compute: async (s, r) => (await profitAndLossTotals(db(), s.companyId, r)).profit },
  { ...base, key: "finance.cash_balance", labelKey: "finance.metrics.cashBalance", unit: "money", kind: "stock", higherIsBetter: true, href: "/finance/accounts", compute: (s, r) => cashBalance(db(), s.companyId, asOf(r)) },
  { ...base, key: "finance.burn_rate", labelKey: "finance.metrics.burnRate", unit: "money", kind: "stock", higherIsBetter: false, href: "/finance/cashflow", compute: async (s, r) => (await burnRate(db(), s.companyId, asOf(r))).netBurn },
  {
    ...base,
    key: "finance.runway_months",
    labelKey: "finance.metrics.runwayMonths",
    unit: "count",
    kind: "stock",
    higherIsBetter: true,
    href: "/finance/cashflow",
    compute: async (s, r) => {
      const at = asOf(r);
      const [cash, burn] = await Promise.all([cashBalance(db(), s.companyId, at), burnRate(db(), s.companyId, at)]);
      // No burn → report a capped horizon rather than infinity.
      return burn.netBurn > 0n ? Number((cash * 10n) / burn.netBurn) / 10 : 999;
    },
  },
  { ...base, key: "finance.mrr", labelKey: "finance.metrics.mrr", unit: "money", kind: "stock", higherIsBetter: true, href: "/finance/recurring", compute: async (s) => (await recurringRevenue(db(), s.companyId)).mrr },
  { ...base, key: "finance.arr", labelKey: "finance.metrics.arr", unit: "money", kind: "stock", higherIsBetter: true, href: "/finance/recurring", compute: async (s) => (await recurringRevenue(db(), s.companyId)).arr },
  { ...base, key: "finance.receivables_overdue", labelKey: "finance.metrics.receivablesOverdue", unit: "money", kind: "stock", higherIsBetter: false, href: "/finance/receivables", compute: (s, r) => overdueReceivables(db(), s.companyId, addDays(asOf(r), 0)) },
];
