import Link from "next/link";
import { cn } from "@/lib/utils";

export const FINANCE_TABS = [
  ["dashboard", ""],
  ["transactions", "/transactions"],
  ["accounts", "/accounts"],
  ["invoices", "/invoices"],
  ["estimates", "/estimates"],
  ["creditNotes", "/credit-notes"],
  ["receivables", "/receivables"],
  ["bills", "/bills"],
  ["payables", "/payables"],
  ["approvals", "/approvals"],
  ["claims", "/claims"],
  ["recurring", "/recurring"],
  ["budgets", "/budgets"],
  ["vendors", "/vendors"],
  ["cashflow", "/cashflow"],
  ["accounting", "/accounting"],
  ["reports", "/reports"],
  ["settings", "/settings"],
] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number][0];

/** Section navigation of Finance OS (scrolls horizontally on small screens). */
export function FinanceTabs({ locale, active, t }: { locale: string; active: FinanceTab; t: (k: string) => string }) {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 text-sm print:hidden" aria-label={t("modules.finance.title")}>
      {FINANCE_TABS.map(([key, path]) => (
        <Link
          key={key}
          href={`/${locale}/finance${path}`}
          aria-current={active === key ? "page" : undefined}
          className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 whitespace-nowrap", active === key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t(`finance.tabs.${key}`)}
        </Link>
      ))}
    </nav>
  );
}

export const ACCOUNTING_TABS = [
  ["chart", ""],
  ["journal", "/journal"],
  ["periods", "/periods"],
  ["reconciliation", "/reconciliation"],
  ["tax", "/tax"],
] as const;
export type AccountingTab = (typeof ACCOUNTING_TABS)[number][0];

export function AccountingTabs({ locale, active, t }: { locale: string; active: AccountingTab; t: (k: string) => string }) {
  return (
    <nav className="flex flex-wrap gap-1 text-sm print:hidden" aria-label={t("finance.tabs.accounting")}>
      {ACCOUNTING_TABS.map(([key, path]) => (
        <Link
          key={key}
          href={`/${locale}/finance/accounting${path}`}
          aria-current={active === key ? "page" : undefined}
          className={cn("rounded-md px-3 py-1.5", active === key ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
        >
          {t(`finance.accounting.tabs.${key}`)}
        </Link>
      ))}
    </nav>
  );
}
