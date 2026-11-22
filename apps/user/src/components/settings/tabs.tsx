"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** Settings sections. Labels: settings.tabs.* (original sections) and enterprise.tabs.* (Enterprise OS sections). */
const TABS = [
  { href: "/settings", label: "settings.tabs.profile" },
  { href: "/settings/security", label: "settings.tabs.security" },
  { href: "/settings/members", label: "settings.tabs.members" },
  { href: "/settings/roles", label: "enterprise.tabs.roles" },
  { href: "/settings/access", label: "enterprise.tabs.access" },
  { href: "/settings/audit", label: "enterprise.tabs.audit" },
  { href: "/settings/usage", label: "enterprise.tabs.usage" },
  { href: "/settings/billing", label: "settings.tabs.billing" },
  { href: "/settings/sso", label: "enterprise.tabs.sso" },
  { href: "/settings/branding", label: "enterprise.tabs.branding" },
  { href: "/settings/data", label: "enterprise.tabs.data" },
];

export function SettingsTabs() {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b" aria-label={t("settings.title")}>
      {TABS.map((tab) => {
        const href = `/${locale}${tab.href}`;
        const active = tab.href === "/settings" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground",
              active ? "border-primary font-medium text-foreground" : "border-transparent",
            )}
          >
            {t(tab.label)}
          </Link>
        );
      })}
    </nav>
  );
}
