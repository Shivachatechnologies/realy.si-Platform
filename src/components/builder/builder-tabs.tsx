"use client";

import Link from "next/link";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** Secondary navigation of the AI Company Builder (/builder/*). */
const TABS = [
  { key: "runs", path: "/builder" },
  { key: "new", path: "/builder/new" },
  { key: "existing", path: "/builder/new?mode=EXISTING" },
  { key: "import", path: "/builder/new?mode=IMPORT" },
  { key: "another", path: "/onboarding?step=business" },
] as const;
export type BuilderTab = (typeof TABS)[number]["key"] | "run";

export function BuilderTabs({ locale, active }: { locale: string; active: BuilderTab }) {
  const t = useT();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 text-sm" aria-label={t("builder.title")}>
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/${locale}${tab.path}`}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 whitespace-nowrap", active === tab.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t(`builder.tabs.${tab.key}`)}
        </Link>
      ))}
    </nav>
  );
}
