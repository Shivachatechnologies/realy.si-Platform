"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings", key: "profile" },
  { href: "/settings/security", key: "security" },
  { href: "/settings/members", key: "members" },
  { href: "/settings/billing", key: "billing" },
];

export function SettingsTabs() {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b" aria-label={t("settings.title")}>
      {TABS.map((tab) => {
        const href = `/${locale}${tab.href}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground", active ? "border-primary font-medium text-foreground" : "border-transparent")}
          >
            {t(`settings.tabs.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
