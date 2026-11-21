"use client";

import Link from "next/link";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "today", path: "/briefing" },
  { key: "history", path: "/briefing/history" },
  { key: "settings", path: "/briefing/settings" },
] as const;

/** Secondary navigation of the briefing area. */
export function BriefingTabs({ locale, active }: { locale: string; active: (typeof TABS)[number]["key"] | null }) {
  const t = useT();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 text-sm" aria-label={t("briefing.title")}>
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/${locale}${tab.path}`}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 whitespace-nowrap", active === tab.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t(`briefing.tabs.${tab.key}`)}
        </Link>
      ))}
    </nav>
  );
}
