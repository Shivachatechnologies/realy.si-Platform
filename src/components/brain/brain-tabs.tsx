"use client";

import Link from "next/link";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** Secondary navigation of Company Brain (/brain, /documents, /brain/memory, /brain/ask). */
const TABS = [
  { key: "search", path: "/brain" },
  { key: "documents", path: "/documents" },
  { key: "memory", path: "/brain/memory" },
  { key: "ask", path: "/brain/ask" },
  { key: "assets", path: "/assets" },
] as const;
export type BrainTab = (typeof TABS)[number]["key"];

export function BrainTabs({ locale, active }: { locale: string; active: BrainTab }) {
  const t = useT();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 text-sm" aria-label={t("modules.brain.title")}>
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/${locale}${tab.path}`}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 whitespace-nowrap", active === tab.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {tab.key === "assets" ? t("assets.tab") : t(`brain.tabs.${tab.key}`)}
        </Link>
      ))}
    </nav>
  );
}
