"use client";

import Link from "next/link";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** Secondary navigation of the objectives (/objectives/*) and company (/company/*) areas. */

const OBJECTIVES_TABS = [
  { key: "objectives", path: "/objectives" },
  { key: "goals", path: "/objectives/goals" },
  { key: "strategy", path: "/company/strategy" },
] as const;
const COMPANY_TABS = [
  { key: "profile", path: "/company" },
  { key: "strategy", path: "/company/strategy" },
  { key: "operations", path: "/company/operations" },
] as const;

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

export function ObjectivesTabs({ locale, active }: { locale: string; active: (typeof OBJECTIVES_TABS)[number]["key"] }) {
  return <Tabs locale={locale} active={active} tabs={OBJECTIVES_TABS} ns="objectives.tabs" label="Objectives" />;
}

export function CompanyTabs({ locale, active }: { locale: string; active: (typeof COMPANY_TABS)[number]["key"] }) {
  return <Tabs locale={locale} active={active} tabs={COMPANY_TABS} ns="strategy.tabs" label="Company" />;
}
