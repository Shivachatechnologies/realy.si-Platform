"use client";

import { usePathname } from "next/navigation";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/ui/breadcrumbs";
import { useI18n } from "@/i18n/client";
import { navTrail } from "./registry";

/**
 * Breadcrumbs derived from the nav registry for the current path (Overview › Section › Page), plus optional
 * trailing items for entity pages (e.g. the user's name). Renders nothing on the overview or unknown paths.
 */
export function AdminBreadcrumbs({ extra = [], className }: { extra?: BreadcrumbItem[]; className?: string }) {
  const { t, locale } = useI18n();
  const pathname = usePathname() ?? "";
  const base = `/${locale}`;
  const rel = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const trail = navTrail(rel);
  if (!trail.length && !extra.length) return null;
  const items: BreadcrumbItem[] = [
    { label: t("admin.nav.overview"), href: base },
    ...trail.map((c) => ({ label: t(c.label), href: `${base}${c.href}` })),
    ...extra,
  ];
  // The last registry crumb is the current page unless entity items follow.
  if (!extra.length && items.length) items[items.length - 1] = { label: items[items.length - 1]!.label };
  return <Breadcrumbs items={items} label={t("admin.common.breadcrumb")} className={className} />;
}
