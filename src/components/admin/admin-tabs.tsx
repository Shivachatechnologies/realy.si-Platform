"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

const TABS = ["", "/pricing", "/countries", "/flags", "/audit", "/system"] as const;
const LABEL: Record<(typeof TABS)[number], string> = { "": "overview", "/pricing": "pricing", "/countries": "countries", "/flags": "flags", "/audit": "audit", "/system": "system" };

export function AdminTabs() {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b" aria-label={t("admin.title")}>
      {TABS.map((tab) => {
        const href = `/${locale}/admin${tab}`;
        const active = pathname === href;
        return (
          <Link
            key={tab}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground", active ? "border-primary font-medium text-foreground" : "border-transparent")}
          >
            {t(`admin.nav.${LABEL[tab]}`)}
          </Link>
        );
      })}
    </nav>
  );
}
