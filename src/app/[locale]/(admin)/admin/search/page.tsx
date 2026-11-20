import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Bot, Building2, Plug, Search, SearchX, ToggleRight, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, EmptyState, sp } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { CONTROL_KEYS, CONTROL_DEFS } from "@/server/core/platform-controls";
import { canPlatform } from "@/server/modules/admin/access";
import { adminSearch } from "@/server/modules/admin/search";
import { requireViewer } from "@/server/session";

const CONTROL_PAGE: Record<string, string> = { ai: "/ai", kill: "/controls", settings: "/settings" };

/** Global admin search results (the full page behind the ⌘K palette), grouped by type. */
export default async function AdminSearchPage({ searchParams }: PageProps<"/[locale]/admin/search">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = sp((await searchParams).q) ?? "";
  const r = await adminSearch(viewer.ctx, q);
  const base = `/${locale}/admin`;
  // Switches/settings also match on their translated label.
  const needle = q.trim().toLowerCase();
  const controls =
    needle.length >= 2 && (await canPlatform(viewer.ctx, "platform.audit.read"))
      ? CONTROL_KEYS.filter((k) => r.controls.includes(k) || t(`admin.controls.keys.${k}.label`).toLowerCase().includes(needle))
      : [];
  const total = r.users.length + r.organizations.length + r.companies.length + r.tasks.length + controls.length + r.integrations.length;
  const group = (title: string, icon: ReactNode, items: ReactNode[]) =>
    items.length ? (
      <Card className="reveal">
        <CardHeader icon={icon} title={title} actions={<Badge>{items.length}</Badge>} />
        <ul className="divide-y">{items}</ul>
      </Card>
    ) : null;
  const row = (key: string, href: string, main: ReactNode, sub?: ReactNode) => (
    <li key={key}>
      <Link href={href} className="group flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{main}</span>
          {sub ? <span className="block truncate text-xs text-muted-foreground">{sub}</span> : null}
        </span>
        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 rtl:-scale-x-100" aria-hidden />
      </Link>
    </li>
  );
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Search />} title={t("admin.search.title")} description={q ? t("admin.search.resultsFor", { q, count: total }) : t("admin.search.hint")} />
      <form role="search" action={`${base}/search`} className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t("admin.search.placeholder")}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input name="q" type="search" defaultValue={q} maxLength={200} placeholder={t("admin.search.palettePlaceholder")} className="h-10 w-full rounded-lg border bg-surface ps-9 pe-3 text-sm placeholder:text-muted-foreground" />
        </label>
        <button type="submit" className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2">
          {t("admin.users.searchButton")}
        </button>
      </form>
      {q.trim().length < 2 ? (
        <EmptyState icon={<Search />} title={t("admin.search.tooShort")} body={t("admin.search.tip")} />
      ) : total === 0 ? (
        <EmptyState icon={<SearchX />} title={t("common.noResults")} body={t("admin.search.noResultsHint")} />
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {group(
          t("admin.nav.users"),
          <User />,
          r.users.map((u) => row(u.id, `${base}/users/${u.id}`, u.name, <>{u.email} · {t(`admin.users.status.${u.status}`)}</>)),
        )}
        {group(
          t("admin.search.organizations"),
          <Building2 />,
          r.organizations.map((o) => row(o.id, `${base}/organizations/${o.id}`, o.name, <>{o.slug} · {t(`admin.organizations.status.${o.status}`)}</>)),
        )}
        {group(
          t("admin.search.companies"),
          <Building2 />,
          r.companies.map((c) => row(c.id, `${base}/organizations/${c.organizationId}`, c.name, c.organization.name)),
        )}
        {group(
          t("admin.nav.aiTasks"),
          <Bot />,
          r.tasks.map((task) => row(task.id, `${base}/ai/tasks?q=${task.id}`, task.title, <><span className="font-mono">{task.id.slice(0, 8)}</span> · {t(`admin.ai.status.${task.status}`)}</>)),
        )}
        {group(
          t("admin.search.controls"),
          <ToggleRight />,
          controls.map((k) => row(k, `${base}${CONTROL_PAGE[CONTROL_DEFS[k].group]}`, t(`admin.controls.keys.${k}.label`), <span className="font-mono">{k}</span>)),
        )}
        {group(
          t("admin.nav.integrations"),
          <Plug />,
          r.integrations.map((i) => row(i.provider, `${base}/integrations?provider=${i.provider}`, i.provider, t("admin.search.connections", { count: i.connections }))),
        )}
      </div>
    </div>
  );
}
