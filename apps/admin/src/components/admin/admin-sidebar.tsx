"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { ArrowRight, CornerDownLeft, Loader2, Search } from "lucide-react";
import { dialogOverlayClass } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { AdminSearchResult } from "@/server/modules/admin/search";
import { ADMIN_NAV } from "./nav/registry";
import { PALETTE_SOURCES, type PaletteHit } from "./palette/registry";

function isActive(pathname: string | null, base: string, href: string) {
  if (pathname === null) return false;
  const full = `${base}${href}`;
  return href === "" ? pathname === base : pathname === full || pathname.startsWith(`${full}/`);
}

function SidebarBase({ pathname }: { pathname: string | null }) {
  const { t, locale } = useI18n();
  const base = `/${locale}`;
  return (
    <ul className="flex gap-1 overflow-x-auto pb-1 lg:grid lg:gap-0.5 lg:overflow-visible lg:pb-0">
      {ADMIN_NAV.map((s) => {
        const sectionActive = isActive(pathname, base, s.href) || !!s.children?.some((c) => isActive(pathname, base, c.href));
        const Icon = s.icon;
        return (
          <li key={s.id} className="shrink-0">
            <Link
              href={`${base}${s.href}`}
              aria-current={sectionActive && !s.children ? "page" : undefined}
              className={cn(
                "relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2",
                sectionActive && "bg-accent font-medium text-accent-foreground",
              )}
            >
              {sectionActive ? <span aria-hidden className="absolute inset-y-2 start-0 hidden w-0.5 rounded-full bg-primary lg:block" /> : null}
              <Icon className={cn("size-4 shrink-0", sectionActive && "text-primary")} aria-hidden />
              <span>{t(s.label)}</span>
            </Link>
            {s.children && sectionActive ? (
              <ul className="ms-6 mt-0.5 hidden gap-0.5 border-s ps-2 lg:grid">
                {s.children.map((c) => {
                  const longer = s.children!.some((o) => o.href !== c.href && o.href.startsWith(`${c.href}/`) && isActive(pathname, base, o.href));
                  const active = pathname === `${base}${c.href}` || (!longer && c.href !== s.href && isActive(pathname, base, c.href)) || (!longer && c.href === s.href && isActive(pathname, base, c.href) && !s.children!.some((o) => o.href !== c.href && isActive(pathname, base, o.href)));
                  return (
                    <li key={c.href}>
                      <Link
                        href={`${base}${c.href}`}
                        aria-current={active ? "page" : undefined}
                        className={cn("block rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2", active && "font-medium text-foreground")}
                      >
                        {t(c.label)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function SidebarWithPath() {
  return <SidebarBase pathname={usePathname()} />;
}

export function AdminSidebar() {
  const { t } = useI18n();
  return (
    <nav aria-label={t("admin.title")} className="lg:sticky lg:top-4">
      <Suspense fallback={<SidebarBase pathname={null} />}>
        <SidebarWithPath />
      </Suspense>
    </nav>
  );
}

// ───────────── Command palette (⌘K) ─────────────

interface Hit extends PaletteHit {
  group: string;
}

/**
 * Global admin search: a ⌘K / Ctrl+K / "/" command palette with sections ("Go to") and live results grouped by type
 * (users, organizations, companies, AI tasks, switches, integrations). Arrow keys move, Enter opens, Esc closes.
 * `controls` lists the switches the admin may see (matched on their translated labels too).
 */
export function AdminSearchBox({ controls = [] }: { controls?: { key: string; group: string }[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const base = `/${locale}`;
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ q: string; data: AdminSearchResult | null } | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = q.trim();
  const searching = open && needle.length >= 2;
  // Results belong to the query they were fetched for; anything else is still loading.
  const data = searching && res?.q === needle ? res.data : null;
  const loading = searching && res?.q !== needle;
  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api<AdminSearchResult>(`/api/v1/admin/search?q=${encodeURIComponent(needle)}`)
        .then((r) => !cancelled && setRes({ q: needle, data: r }))
        .catch(() => !cancelled && setRes({ q: needle, data: null }));
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [needle, searching]);

  const hits = useMemo<Hit[]>(() => {
    const low = needle.toLowerCase();
    const nav: Hit[] = ADMIN_NAV.flatMap((s): Hit[] => [
      { id: `nav:${s.id}`, group: "nav", label: t(s.label), href: `${base}${s.href}`, icon: s.icon },
      ...(s.children ?? [])
        .filter((c) => c.href !== s.href)
        .map((c) => ({ id: `nav:${c.id}`, group: "nav", label: t(c.label), sub: t(s.label), href: `${base}${c.href}`, icon: s.icon })),
    ]).filter((h) => !low || h.label.toLowerCase().includes(low) || h.sub?.toLowerCase().includes(low));
    const out: Hit[] = low ? nav.slice(0, 5) : nav;
    // Stream sources (palette/sources/<stream>.ts): live search groups and static commands, in registry order.
    if (low) {
      const ctx = { t, base, needle, low, data, controls };
      for (const src of PALETTE_SOURCES) for (const h of src.hits(ctx)) out.push({ ...h, group: src.group });
    }
    if (low.length >= 2) out.push({ id: "all", group: "all", label: t("admin.search.seeAll", { q: needle }), href: `${base}/search?q=${encodeURIComponent(needle)}`, icon: Search });
    return out;
  }, [needle, data, controls, base, t]);

  const current = Math.min(active, Math.max(0, hits.length - 1));

  const go = useCallback(
    (h: Hit | undefined) => {
      if (!h) return;
      setOpen(false);
      router.push(h.href);
    },
    [router],
  );

  const groupLabel: Record<string, string> = {
    nav: t("admin.search.groups.nav"),
    ...Object.fromEntries(PALETTE_SOURCES.map((src) => [src.group, t(src.label)])),
    all: t("admin.search.groups.more"),
  };
  const groups = [...new Set(hits.map((h) => h.group))];
  const activeId = hits[current] ? `${listId}-${current}` : undefined;

  return (
    <D.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <D.Trigger asChild>
        <button
          type="button"
          className="group relative flex h-8 w-full max-w-xs items-center gap-2 rounded-md border bg-surface ps-2.5 pe-2 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2"
          aria-keyshortcuts="Meta+K Control+K /"
        >
          <Search className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t("admin.search.placeholder")}</span>
          <kbd className="ms-auto hidden rounded border bg-muted px-1 font-mono text-[10px] sm:inline">⌘K</kbd>
        </button>
      </D.Trigger>
      <D.Portal>
        <D.Overlay className={dialogOverlayClass} />
        <D.Content
          className="fixed start-1/2 top-[10vh] z-50 grid max-h-[75vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl border glass-strong shadow-elev-4 outline-none rtl:translate-x-1/2 data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <D.Title className="sr-only">{t("admin.search.title")}</D.Title>
          <D.Description className="sr-only">{t("admin.search.paletteHint")}</D.Description>
          <div className="flex items-center gap-2 border-b px-3">
            {loading ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden /> : <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-label={t("admin.search.placeholder")}
              value={q}
              maxLength={200}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive(Math.min(hits.length - 1, current + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive(Math.max(0, current - 1));
                } else if (e.key === "Home") {
                  setActive(0);
                } else if (e.key === "End") {
                  setActive(hits.length - 1);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  go(hits[current]);
                }
              }}
              placeholder={t("admin.search.palettePlaceholder")}
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">Esc</kbd>
          </div>
          <div id={listId} role="listbox" aria-label={t("admin.search.title")} className="overflow-y-auto p-2">
            {groups.map((g) => (
              <div key={g} role="group" aria-label={groupLabel[g]} className="mb-1">
                <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{groupLabel[g]}</div>
                {hits.map((h, i) =>
                  h.group === g ? (
                    <div
                      key={h.id}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === current}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(h)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm",
                        i === current ? "bg-accent text-accent-foreground" : "text-foreground",
                      )}
                    >
                      <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-md border bg-surface [&_svg]:size-3.5", i === current && "border-primary/40 text-primary")}>
                        <h.icon />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{h.label}</span>
                        {h.sub ? <span className="block truncate text-xs text-muted-foreground">{h.sub}</span> : null}
                      </span>
                      {i === current ? <ArrowRight className="size-3.5 shrink-0 rtl:-scale-x-100" aria-hidden /> : null}
                    </div>
                  ) : null,
                )}
              </div>
            ))}
            {needle.length >= 2 && !loading && data && hits.every((h) => h.group === "nav" || h.group === "all") ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("common.noResults")}</p>
            ) : null}
            {needle.length === 1 ? <p className="px-2 py-2 text-xs text-muted-foreground">{t("admin.search.tooShort")}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-surface-2/60 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border px-1 font-mono">↑</kbd>
              <kbd className="rounded border px-1 font-mono">↓</kbd>
              {t("admin.search.keyMove")}
            </span>
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft className="size-3" aria-hidden />
              {t("admin.search.keyOpen")}
            </span>
            <span className="ms-auto">{t("admin.search.scopeNote")}</span>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
