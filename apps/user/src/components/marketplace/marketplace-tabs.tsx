"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** Browse | Installed | Publish | Review (reviewers only). */
export function MarketplaceTabs({ reviewer }: { reviewer: boolean }) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const base = `/${locale}/marketplace`;
  const tabs = [
    {
      key: "browse",
      href: base,
      active: pathname === base || (!["/installed", "/publish", "/review"].some((p) => pathname.startsWith(base + p)) && pathname.startsWith(base)),
    },
    {
      key: "installed",
      href: `${base}/installed`,
      active: pathname.startsWith(`${base}/installed`),
    },
    {
      key: "publish",
      href: `${base}/publish`,
      active: pathname.startsWith(`${base}/publish`),
    },
    ...(reviewer
      ? [
          {
            key: "review",
            href: `${base}/review`,
            active: pathname.startsWith(`${base}/review`),
          },
        ]
      : []),
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto border-b text-sm" aria-label={t("marketplace.title")}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 whitespace-nowrap",
            tab.active ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t(`marketplace.tabs.${tab.key}`)}
        </Link>
      ))}
    </nav>
  );
}
