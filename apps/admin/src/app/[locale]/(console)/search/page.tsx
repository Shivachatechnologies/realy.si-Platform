import Link from "next/link";
import { ArrowUpRight, Search, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, EmptyState, sp } from "@/components/admin/kit";
import { visibleNav } from "@/components/admin/nav/registry";
import { PALETTE_SOURCES, type PaletteContext, type PaletteHit } from "@/components/admin/palette/registry";
import { getLocale, getT } from "@/i18n/server";
import { CONTROL_DEFS, CONTROL_KEYS } from "@/server/core/platform-controls";
import { adminSearch } from "@/server/modules/admin/search";
import { consolePermissions } from "@/server/modules/admin/preferences";
import { requireViewer } from "@/server/session";

/**
 * Global admin search results (the full page behind the ⌘K palette), registry-driven: matching console sections, then
 * every stream's palette source over the live result of every search provider (BE/admin/search/providers/*), in
 * registry order. Groups the admin may not read are empty on the server and do not render.
 */
export default async function AdminSearchPage({ searchParams }: PageProps<"/[locale]/search">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = sp((await searchParams).q) ?? "";
  const [data, perms] = await Promise.all([adminSearch(viewer.ctx, q), consolePermissions(viewer.ctx)]);
  const allowed = new Set(perms);
  const base = `/${locale}`;
  const needle = q.trim();
  const low = needle.toLowerCase();
  const controls = allowed.has("platform.audit.read") ? CONTROL_KEYS.map((key) => ({ key, group: CONTROL_DEFS[key].group })) : [];
  const ctx: PaletteContext = { t, base, needle, low, data, controls, can: (p) => p.length === 0 || p.some((k) => allowed.has(k)), path: "/search" };

  const groups: { id: string; title: string; hits: PaletteHit[] }[] = [];
  if (low.length >= 2) {
    const nav = visibleNav(allowed).flatMap((s): PaletteHit[] => [
      { id: `nav:${s.id}`, label: t(s.label), href: `${base}${s.href}`, icon: s.icon },
      ...(s.children ?? []).filter((c) => c.href !== s.href).map((c) => ({ id: `nav:${s.id}:${c.id}`, label: t(c.label), sub: t(s.label), href: `${base}${c.href}`, icon: s.icon })),
    ]);
    const navHits = nav.filter((h) => h.label.toLowerCase().includes(low) || h.sub?.toLowerCase().includes(low));
    if (navHits.length) groups.push({ id: "nav", title: t("admin.search.groups.nav"), hits: navHits });
    for (const src of PALETTE_SOURCES) {
      if (src.group === "quick") continue;
      const hits = src.hits(ctx);
      if (hits.length) groups.push({ id: src.group, title: t(src.label), hits });
    }
  }
  const total = groups.filter((g) => g.id !== "nav").reduce((a, g) => a + g.hits.length, 0);

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
      {needle.length < 2 ? (
        <EmptyState icon={<Search />} title={t("admin.search.tooShort")} body={t("admin.search.tip")} />
      ) : groups.length === 0 ? (
        <EmptyState icon={<SearchX />} title={t("common.noResults")} body={t("admin.search.noResultsHint")} />
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.id} className="reveal">
            <CardHeader title={g.title} actions={<Badge>{g.hits.length}</Badge>} />
            <ul className="divide-y">
              {g.hits.map((h) => (
                <li key={h.id}>
                  <Link href={h.href} className="group flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-2">
                    <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md border bg-surface text-muted-foreground [&_svg]:size-3.5">
                      <h.icon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{h.label}</span>
                      {h.sub ? <span className="block truncate text-xs text-muted-foreground">{h.sub}</span> : null}
                    </span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 rtl:-scale-x-100" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
