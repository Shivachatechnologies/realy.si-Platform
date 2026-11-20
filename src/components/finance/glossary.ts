/**
 * Plain-language finance glossary (texts in `finance.glossary.terms.<key>.{term,short,example}`). Groups follow how a
 * founder meets the words: money in, money out, the big picture, planning, bookkeeping. `href` links each term to the
 * page where it lives in Finance OS.
 */
export const GLOSSARY_GROUPS = [
  { key: "moneyIn", terms: ["revenue", "invoice", "receivable", "estimate", "creditNote", "paymentLink", "mrr", "arr"] },
  { key: "moneyOut", terms: ["expense", "bill", "payable", "overdue", "costCenter", "projectCost"] },
  { key: "bigPicture", terms: ["profit", "margin", "pnl", "balanceSheet", "asset", "liability", "equity", "cashFlow"] },
  { key: "planning", terms: ["cashBalance", "burnRate", "runway", "budget", "variance", "forecast"] },
  { key: "bookkeeping", terms: ["ledger", "journalEntry", "reconciliation", "tax", "accrual"] },
] as const;

export type GlossaryTerm = (typeof GLOSSARY_GROUPS)[number]["terms"][number];

export const GLOSSARY_HREF: Partial<Record<GlossaryTerm, string>> = {
  revenue: "/reports?report=revenue",
  invoice: "/invoices",
  receivable: "/receivables",
  estimate: "/estimates",
  creditNote: "/credit-notes",
  paymentLink: "/invoices",
  mrr: "/recurring",
  arr: "/recurring",
  expense: "/transactions",
  bill: "/bills",
  payable: "/payables",
  overdue: "/alerts",
  costCenter: "/budgets",
  projectCost: "/reports?report=projects",
  profit: "/reports?report=pnl",
  margin: "/reports?report=pnl",
  pnl: "/reports?report=pnl",
  balanceSheet: "/reports?report=balance",
  asset: "/reports?report=balance",
  liability: "/reports?report=balance",
  equity: "/reports?report=balance",
  cashFlow: "/cashflow",
  cashBalance: "/accounts",
  burnRate: "/cashflow",
  runway: "/alerts",
  budget: "/budgets",
  variance: "/reports?report=budget",
  forecast: "/cashflow",
  ledger: "/accounting",
  journalEntry: "/accounting/journal",
  reconciliation: "/accounting/reconciliation",
  tax: "/accounting/tax",
};
