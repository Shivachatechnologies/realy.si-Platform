"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Dialog as D } from "radix-ui";
import { ChevronDown, ChevronsLeft, ChevronsRight, Clock, Search, Star, X } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { isTyping, useShell } from "@/components/shell/shell-context";
import { NAV_GROUPS, navAllowed, navEntryFor, navGroup, visibleNav, type NavGroup, type NavItem, type NavSection } from "./nav/registry";

export { CommandPalette as AdminSearchBox } from "./palette/command-palette";

const LABEL_KEY = /^admin\.[\w.]+$/;

function activeHref(pathname: string, base: string, sections: NavSection[]): string | null {
  const rel = pathname.startsWith(base) ? pathname.slice(base.length) || "" : pathname;
  let best: string | null = null;
  for (const s of sections)
    for (const item of [s, ...(s.children ?? [])]) {
      const h = item.href;
      const hit = h === "" ? rel === "" : rel === h || rel.startsWith(`${h}/`);
      if (hit && (best === null || h.length > best.length)) best = h;
    }
  return best;
}

function Count({ n, collapsed }: { n: number | undefined; collapsed?: boolean }) {
  if (!n) return null;
  const text = n > 99 ? "99+" : String(n);
  return collapsed ? (
    <span aria-hidden className="absolute end-1 top-1 size-2 rounded-full bg-danger ring-2 ring-background" />
  ) : (
    <span className="ms-auto rounded-full bg-danger/12 px-1.5 text-[10px] leading-4 font-semibold text-danger tabular-nums">{text}</span>
  );
}

/**
 * Console navigation v2 (stream A): permission-filtered registry (sections the admin cannot open are hidden),
 * grouped, nested and collapsible sections, a filter box, favorites and recents (persisted per admin), badge counts,
 * icon-only collapse (persisted; `[` toggles) and keyboard navigation (↑ ↓ Home End move, → ← expand/collapse).
 * Renders inline on large screens and inside the mobile drawer (`drawer`).
 */
function SidebarPanel({ drawer = false }: { drawer?: boolean }) {
  const { t, locale } = useI18n();
  const shell = useShell();
  const pathname = usePathname() ?? "";
  const base = `/${locale}`;
  const collapsed = !drawer && shell.prefs.collapsed;
  const [filter, setFilter] = useState("");
  const navRef = useRef<HTMLDivElement>(null);
  const sections = useMemo(() => visibleNav(shell.perms), [shell.perms]);
  const current = activeHref(pathname, base, sections);
  const low = filter.trim().toLowerCase();
  const badge = (item: NavItem) => (item.badge ? shell.badges[item.badge] : undefined);
  const sectionBadge = (s: NavSection) => badge(s) ?? (s.children ?? []).reduce((a, c) => a + (badge(c) ?? 0), 0);
  const label = (l: string) => (LABEL_KEY.test(l) ? t(l) : l);

  // Recents: remember registry pages the admin opens (own row; a repeat of the newest entry writes nothing).
  const lastSent = useRef<string | null>(null);
  useEffect(() => {
    if (drawer || current === null) return;
    const rel = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
    if (rel !== current || lastSent.current === current) return;
    const entry = navEntryFor(current);
    if (!entry) return;
    lastSent.current = current;
    void api("/api/v1/admin/me/recents", { method: "POST", body: { href: current || "/", label: entry.item.label } }).catch(() => undefined);
  }, [current, pathname, base, drawer]);

  // "[" toggles the icon-only sidebar (not while typing).
  const { setCollapsed, prefs } = shell;
  useEffect(() => {
    if (drawer) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "[" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        setCollapsed(!prefs.collapsed);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, setCollapsed, prefs.collapsed]);

  const onNavKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(navRef.current?.querySelectorAll<HTMLElement>("[data-nav-item]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const move = (n: number) => {
      e.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, n))]?.focus();
    };
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(items.length - 1);
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const id = items[i]!.dataset.section;
      if (id && !collapsed) {
        e.preventDefault();
        shell.setGroupOpen(id, e.key === "ArrowRight");
      }
    }
  };

  const matches = (item: NavItem, s?: NavSection) => !low || label(item.label).toLowerCase().includes(low) || (s ? label(s.label).toLowerCase().includes(low) : false);
  const linkCls = (active: boolean) =>
    cn(
      "group/nav relative flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2",
      active && "bg-accent font-medium text-accent-foreground",
      collapsed && "justify-center px-0",
    );
  const close = () => {
    if (drawer) shell.setDrawerOpen(false);
  };

  const star = (href: string, name: string) => {
    const on = shell.prefs.favorites.includes(href);
    const text = on ? t("admin.shell.unfavorite", { name }) : t("admin.shell.favorite", { name });
    return (
      <button
        type="button"
        onClick={() => shell.toggleFavorite(href)}
        aria-pressed={on}
        aria-label={text}
        title={text}
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-warning focus-visible:opacity-100 focus-visible:outline-2 pointer-coarse:opacity-100",
          on && "text-warning opacity-100",
        )}
      >
        <Star className={cn("size-3.5", on && "fill-current")} aria-hidden />
      </button>
    );
  };

  const favorites = shell.prefs.favorites
    .map((href) => ({ href, entry: navEntryFor(href === "/" ? "" : href) }))
    .filter((f) => f.entry && navAllowed(f.entry.section, shell.perms) && navAllowed(f.entry.item, shell.perms));
  const recents = shell.prefs.recents.filter((r) => !shell.prefs.favorites.includes(r.href) && navEntryFor(r.href === "/" ? "" : r.href)).slice(0, 5);
  const grouped = NAV_GROUPS.map((g) => ({ g, items: sections.filter((s) => navGroup(s) === g) })).filter((x) => x.items.length);
  const anyMatch = grouped.some(({ items }) => items.some((s) => matches(s) || (s.children ?? []).some((c) => matches(c, s))));

  const groupTitle = (g: NavGroup | "favorites" | "recents") =>
    collapsed ? <div aria-hidden className="mx-auto my-2 h-px w-6 bg-border" /> : <div className="px-2 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{t(`admin.shell.groups.${g}`)}</div>;

  return (
    <div className="flex h-full w-full flex-col gap-1">
      {!collapsed ? (
        <label className="relative block px-0.5">
          <span className="sr-only">{t("admin.shell.filterNav")}</span>
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                navRef.current?.querySelector<HTMLElement>("[data-nav-item]")?.focus();
              } else if (e.key === "Escape") setFilter("");
            }}
            placeholder={t("admin.shell.filterNav")}
            maxLength={60}
            className="h-8 w-full rounded-md border bg-surface ps-8 pe-2 text-xs placeholder:text-muted-foreground focus-visible:outline-2"
          />
        </label>
      ) : null}
      <div ref={navRef} onKeyDown={onNavKey} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {!low && favorites.length ? (
          <section aria-label={t("admin.shell.groups.favorites")}>
            {groupTitle("favorites")}
            <ul className="grid gap-0.5">
              {favorites.map(({ href, entry }) => {
                const Icon = entry!.section.icon;
                const h = href === "/" ? "" : href;
                const name = label(entry!.item.label);
                return (
                  <li key={`fav:${href}`} className="group/row flex items-center">
                    <Link data-nav-item href={`${base}${h}`} onClick={close} aria-current={current === h ? "page" : undefined} title={collapsed ? name : undefined} aria-label={collapsed ? name : undefined} className={linkCls(current === h)}>
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {!collapsed ? <span className="truncate">{name}</span> : null}
                      <Count n={badge(entry!.item)} collapsed={collapsed} />
                    </Link>
                    {!collapsed ? star(href, name) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {!low && !collapsed && recents.length ? (
          <section aria-label={t("admin.shell.groups.recents")}>
            {groupTitle("recents")}
            <ul className="grid gap-0.5">
              {recents.map((r) => (
                <li key={`rec:${r.href}`} className="flex">
                  <Link data-nav-item href={`${base}${r.href === "/" ? "" : r.href}`} onClick={close} className={linkCls(false)}>
                    <Clock className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate text-xs">{label(r.label)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {grouped.map(({ g, items }) => {
          const shown = items.filter((s) => matches(s) || (s.children ?? []).some((c) => matches(c, s)));
          if (!shown.length) return null;
          return (
            <section key={g} aria-label={t(`admin.shell.groups.${g}`)}>
              {groupTitle(g)}
              <ul className="grid gap-0.5">
                {shown.map((s) => {
                  const Icon = s.icon;
                  const kids = s.children ?? [];
                  const hasKids = kids.length > 1 || (kids.length === 1 && kids[0]!.href !== s.href);
                  const inSection = current !== null && (current === s.href || kids.some((c) => c.href === current));
                  const open = hasKids && !collapsed && (low ? true : (shell.prefs.groups[s.id] ?? inSection));
                  const name = t(s.label);
                  const count = sectionBadge(s);
                  return (
                    <li key={s.id}>
                      <div className="group/row flex items-center">
                        <Link
                          data-nav-item
                          data-section={hasKids ? s.id : undefined}
                          href={`${base}${s.href}`}
                          onClick={close}
                          aria-current={current === s.href && !hasKids ? "page" : undefined}
                          title={collapsed ? name : undefined}
                          aria-label={collapsed ? (count ? `${name} (${count})` : name) : undefined}
                          className={linkCls(inSection && (collapsed || !open))}
                        >
                          {inSection ? <span aria-hidden className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-primary" /> : null}
                          <Icon className={cn("size-4 shrink-0", inSection && "text-primary")} aria-hidden />
                          {!collapsed ? <span className="truncate">{name}</span> : null}
                          <Count n={count} collapsed={collapsed} />
                        </Link>
                        {!collapsed && hasKids ? (
                          <button
                            type="button"
                            onClick={() => shell.setGroupOpen(s.id, !open)}
                            aria-label={open ? t("admin.shell.collapseSection", { name }) : t("admin.shell.expandSection", { name })}
                            aria-expanded={open}
                            className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2"
                          >
                            <ChevronDown className={cn("size-3.5 transition-transform motion-reduce:transition-none", !open && "-rotate-90 rtl:rotate-90")} aria-hidden />
                          </button>
                        ) : !collapsed ? (
                          star(s.href || "/", name)
                        ) : null}
                      </div>
                      {open ? (
                        <ul className="ms-4 mt-0.5 mb-1 grid gap-0.5 border-s ps-2">
                          {kids
                            .filter((c) => matches(c, s))
                            .map((c) => {
                              const active = current === c.href;
                              const cname = t(c.label);
                              return (
                                <li key={c.id + c.href} className="group/row flex items-center">
                                  <Link
                                    data-nav-item
                                    href={`${base}${c.href}`}
                                    onClick={close}
                                    aria-current={active ? "page" : undefined}
                                    className={cn("flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2", active && "bg-muted font-medium text-foreground")}
                                  >
                                    <span className="truncate">{cname}</span>
                                    <Count n={badge(c)} />
                                  </Link>
                                  {star(c.href || "/", cname)}
                                </li>
                              );
                            })}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {low && !anyMatch ? <p className="px-2 py-4 text-xs text-muted-foreground">{t("admin.shell.noNavMatch")}</p> : null}
      </div>
      {!drawer ? (
        <button
          type="button"
          onClick={() => shell.setCollapsed(!collapsed)}
          aria-keyshortcuts="["
          aria-label={collapsed ? t("admin.shell.expandSidebar") : t("admin.shell.collapseSidebar")}
          title={`${collapsed ? t("admin.shell.expandSidebar") : t("admin.shell.collapseSidebar")} ([)`}
          className={cn("flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2", collapsed && "justify-center px-0")}
        >
          {collapsed ? <ChevronsRight className="size-4 rtl:-scale-x-100" aria-hidden /> : <ChevronsLeft className="size-4 rtl:-scale-x-100" aria-hidden />}
          {!collapsed ? <span>{t("admin.shell.collapseSidebar")}</span> : null}
        </button>
      ) : null}
    </div>
  );
}

/** Large screens: the sticky inline sidebar (full width or icon-only). Small screens use <AdminNavDrawer>. */
export function AdminSidebar() {
  const { t } = useI18n();
  const { prefs } = useShell();
  return (
    <nav aria-label={t("admin.shell.navigation")} className={cn("sticky top-16 hidden h-[calc(100dvh-5rem)] shrink-0 lg:block", prefs.collapsed ? "w-12" : "w-[220px]")}>
      <SidebarPanel />
    </nav>
  );
}

/** Small screens: the same navigation in a slide-in drawer, opened from the top bar menu button. */
export function AdminNavDrawer() {
  const { t } = useI18n();
  const shell = useShell();
  return (
    <D.Root open={shell.drawerOpen} onOpenChange={shell.setDrawerOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-[oklch(0.12_0.02_275/0.45)] backdrop-blur-[2px] lg:hidden" />
        <D.Content className="fixed inset-y-0 start-0 z-50 flex w-[min(20rem,85vw)] flex-col gap-2 border-e bg-background p-3 shadow-elev-4 outline-none lg:hidden">
          <div className="flex items-center justify-between">
            <D.Title className="text-sm font-semibold">{t("admin.shell.navigation")}</D.Title>
            <D.Description className="sr-only">{t("admin.shell.navigationHint")}</D.Description>
            <D.Close aria-label={t("common.close")} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2">
              <X className="size-4" aria-hidden />
            </D.Close>
          </div>
          <nav aria-label={t("admin.shell.navigation")} className="min-h-0 flex-1">
            <SidebarPanel drawer />
          </nav>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
