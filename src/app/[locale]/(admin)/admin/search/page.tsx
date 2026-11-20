import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, Empty, sp } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { CONTROL_KEYS, CONTROL_DEFS } from "@/server/core/platform-controls";
import { canPlatform } from "@/server/modules/admin/access";
import { adminSearch } from "@/server/modules/admin/search";
import { requireViewer } from "@/server/session";

const CONTROL_PAGE: Record<string, string> = { ai: "/ai", kill: "/controls", settings: "/settings" };

/** Global admin search results (⌘K in the console header). */
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
  const group = (title: string, items: ReactNode[]) =>
    items.length ? (
      <Card>
        <CardHeader title={title} />
        <ul className="divide-y">{items}</ul>
      </Card>
    ) : null;
  const row = (key: string, href: string, main: ReactNode, sub?: ReactNode) => (
    <li key={key}>
      <Link href={href} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm hover:bg-muted/50">
        {main}
        {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
      </Link>
    </li>
  );
  return (
    <div className="grid gap-4">
      <AdminHeader title={t("admin.search.title")} description={q ? t("admin.search.resultsFor", { q, count: total }) : t("admin.search.hint")} />
      {q.trim().length < 2 ? <Empty>{t("admin.search.tooShort")}</Empty> : total === 0 ? <Empty>{t("common.noResults")}</Empty> : null}
      {group(
        t("admin.nav.users"),
        r.users.map((u) => row(u.id, `${base}/users/${u.id}`, <span className="font-medium">{u.name}</span>, <>{u.email} · {t(`admin.users.status.${u.status}`)}</>)),
      )}
      {group(
        t("admin.search.organizations"),
        r.organizations.map((o) => row(o.id, `${base}/organizations/${o.id}`, <span className="font-medium">{o.name}</span>, <>{o.slug} · {t(`admin.organizations.status.${o.status}`)}</>)),
      )}
      {group(
        t("admin.search.companies"),
        r.companies.map((c) => row(c.id, `${base}/organizations/${c.organizationId}`, <span className="font-medium">{c.name}</span>, c.organization.name)),
      )}
      {group(
        t("admin.nav.aiTasks"),
        r.tasks.map((task) => row(task.id, `${base}/ai/tasks?q=${task.id}`, <span className="font-medium">{task.title}</span>, <><span className="font-mono">{task.id.slice(0, 8)}</span> · {t(`admin.ai.status.${task.status}`)}</>)),
      )}
      {group(
        t("admin.search.controls"),
        controls.map((k) => row(k, `${base}${CONTROL_PAGE[CONTROL_DEFS[k].group]}`, <span className="font-medium">{t(`admin.controls.keys.${k}.label`)}</span>, <Badge>{k}</Badge>)),
      )}
      {group(
        t("admin.nav.integrations"),
        r.integrations.map((i) => row(i.provider, `${base}/integrations?provider=${i.provider}`, <span className="font-medium">{i.provider}</span>, t("admin.search.connections", { count: i.connections }))),
      )}
    </div>
  );
}
