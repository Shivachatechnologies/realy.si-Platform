"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/ui/breadcrumbs";
import { useShell } from "@/components/shell/shell-context";
import { useI18n } from "@/i18n/client";
import { navTrail } from "./registry";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Breadcrumb items for a locale-relative path: Overview › Section › Page from the nav registry, then either the
 * page's own `extra` items (entity names) or, for paths deeper than the registry, the remaining segments (ids shown
 * as "Details", others as-is). Duplicates (the overview section) are dropped. The last item is the current page.
 */
export function useCrumbs(extra: BreadcrumbItem[] = []): BreadcrumbItem[] {
  const { t, locale } = useI18n();
  const pathname = usePathname() ?? "";
  const base = `/${locale}`;
  const rel = (pathname.startsWith(base) ? pathname.slice(base.length) : pathname).replace(/\/+$/, "");
  const trail = navTrail(rel);
  const items: BreadcrumbItem[] = [{ label: t("admin.nav.overview"), href: base }];
  for (const c of trail) if (c.href !== "" && !items.some((i) => i.href === `${base}${c.href}`)) items.push({ label: t(c.label), href: `${base}${c.href}` });
  if (extra.length) items.push(...extra);
  else {
    const matched = trail.length ? trail[trail.length - 1]!.href : "";
    const rest = rel.slice(matched.length).split("/").filter(Boolean);
    let href = `${base}${matched}`;
    for (const seg of rest) {
      href += `/${seg}`;
      items.push({ label: UUID.test(seg) ? t("admin.shell.details") : decodeURIComponent(seg), href });
    }
  }
  if (rel === "") items[0] = { label: t("admin.nav.commandCenter") };
  const last = items[items.length - 1]!;
  items[items.length - 1] = { label: last.label };
  return items;
}

/** Breadcrumbs derived from the nav registry for the current path, plus optional `extra` entity items. */
export function AdminBreadcrumbs({ extra = [], className }: { extra?: BreadcrumbItem[]; className?: string }) {
  const { t } = useI18n();
  const items = useCrumbs(extra);
  return <Breadcrumbs items={items} label={t("admin.common.breadcrumb")} className={className} />;
}

/** The shell's breadcrumb bar (every console page): registry trail plus what the page set with <PageCrumbs>. */
export function ShellBreadcrumbs({ className }: { className?: string }) {
  const { crumbs } = useShell();
  return <AdminBreadcrumbs extra={crumbs} className={className} />;
}

/**
 * Set the trailing breadcrumb items of the current page (e.g. `[{ label: user.name }]`) from a server page:
 * `<PageCrumbs items={[{ label: org.name }]} />`. Renders nothing; the shell bar shows them.
 */
export function PageCrumbs({ items }: { items: BreadcrumbItem[] }) {
  const { setCrumbs } = useShell();
  const key = JSON.stringify(items);
  useEffect(() => {
    setCrumbs(JSON.parse(key) as BreadcrumbItem[]);
    return () => setCrumbs([]);
  }, [key, setCrumbs]);
  return null;
}
