"use client";

import Link from "next/link";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** Secondary navigation of the CRM (/crm/*) and Sales (/sales/*) areas. */

const CRM_TABS = [
  { key: "today", path: "/crm/today" },
  { key: "leads", path: "/crm" },
  { key: "discover", path: "/crm/discover" },
  { key: "contacts", path: "/crm/contacts" },
  { key: "accounts", path: "/crm/accounts" },
  { key: "deals", path: "/crm/deals" },
  { key: "pipeline", path: "/crm/pipeline" },
  { key: "outreach", path: "/crm/outreach" },
  { key: "sequences", path: "/crm/sequences" },
  { key: "meetings", path: "/crm/meetings" },
  { key: "proposals", path: "/crm/proposals" },
  { key: "calendar", path: "/crm/calendar" },
  { key: "dashboard", path: "/crm/dashboard" },
  { key: "import", path: "/crm/import" },
  { key: "settings", path: "/crm/settings" },
] as const;
const SALES_TABS = [
  { key: "overview", path: "/sales" },
  { key: "start", path: "/sales/start" },
  { key: "targets", path: "/sales/targets" },
  { key: "commissions", path: "/sales/commissions" },
  { key: "reports", path: "/sales/reports" },
  { key: "team", path: "/sales/team" },
] as const;

export type CrmTab = (typeof CRM_TABS)[number]["key"];
export type SalesTab = (typeof SALES_TABS)[number]["key"];

function Tabs({ locale, active, tabs, ns, label }: { locale: string; active: string; tabs: readonly { key: string; path: string }[]; ns: string; label: string }) {
  const t = useT();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 text-sm" aria-label={label}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`/${locale}${tab.path}`}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 whitespace-nowrap", active === tab.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t(`${ns}.${tab.key}`)}
        </Link>
      ))}
    </nav>
  );
}

export function CrmTabs({ locale, active }: { locale: string; active: CrmTab; labels?: Record<string, string> }) {
  return <Tabs locale={locale} active={active} tabs={CRM_TABS} ns="crm.tabs" label="CRM" />;
}

export function SalesTabs({ locale, active }: { locale: string; active: SalesTab }) {
  return <Tabs locale={locale} active={active} tabs={SALES_TABS} ns="sales.tabs" label="Sales" />;
}
