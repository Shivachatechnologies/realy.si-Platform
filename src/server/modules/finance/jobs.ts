import type { ModuleJobs } from "@/server/core/module-jobs";
import { markOverdueInvoices, runDueRecurringInvoices } from "./billing";
import { runDueRecurringExpenses } from "./transactions";
import { notifyOverdueBills } from "./payables";
import { runBudgetAlerts } from "./budgets";

const HOUR = 60 * 60_000;

/** Background work of the finance module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const FINANCE_JOBS: ModuleJobs = {
  periodic: [
    { name: "finance.recurring_expenses", everyMs: HOUR, run: () => runDueRecurringExpenses() },
    { name: "finance.recurring_invoices", everyMs: HOUR, run: () => runDueRecurringInvoices() },
    { name: "finance.overdue_invoices", everyMs: HOUR, run: () => markOverdueInvoices() },
    { name: "finance.overdue_bills", everyMs: HOUR, run: () => notifyOverdueBills() },
    { name: "finance.budget_alerts", everyMs: HOUR, run: () => runBudgetAlerts() },
  ],
  onEvent: [],
};
