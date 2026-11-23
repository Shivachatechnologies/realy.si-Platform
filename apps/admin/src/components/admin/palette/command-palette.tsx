"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { ArrowRight, Clipboard, CornerDownLeft, History, Keyboard, Loader2, PanelLeft, Rows3, ScrollText, Search, Star, type LucideIcon } from "lucide-react";
import { dialogOverlayClass } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { isTyping, useShell } from "@/components/shell/shell-context";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { AdminSearchResult } from "@/server/modules/admin/search";
import { navEntryFor, visibleNav } from "../nav/registry";
import { PALETTE_SOURCES, type PaletteContext } from "./registry";
import { ShortcutsDialog } from "./shortcuts";

interface Hit {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: LucideIcon;
  href?: string;
  run?: () => void;
  /** Keep the palette open after running (e.g. filling the query). */
  keepOpen?: boolean;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const AUDIT = ["platform.audit.read", "platform.security.read"];

/**
 * ⌘K command palette v2 (stream A). Opens with ⌘K / Ctrl+K / "/". Empty query: recent searches, quick commands,
 * actions for the current page and every section the admin may open. While typing: matching sections, live results
 * from every registered search provider (rendered by the stream palette sources, `./sources/*.ts`), matching
 * commands and "see all results". Commands and sections the admin cannot open are hidden (UI hint; the server
 * still enforces). Arrow keys move, Enter opens, Esc closes, "?" lists every shortcut.
 */
export function CommandPalette({ controls = [] }: { controls?: { key: string; group: string }[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const shell = useShell();
  const pathname = usePathname() ?? "";
  const base = `/${locale}`;
  const path = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ q: string; data: AdminSearchResult | null; failed?: boolean } | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !isTyping(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "?" && !isTyping(e.target)) {
        e.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = q.trim();
  const searching = open && needle.length >= 2;
  const data = searching && res?.q === needle ? res.data : null;
  const failed = searching && res?.q === needle && !!res.failed;
  const loading = searching && res?.q !== needle;
  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api<AdminSearchResult>(`/api/v1/admin/search?q=${encodeURIComponent(needle)}`)
        .then((r) => !cancelled && setRes({ q: needle, data: r }))
        .catch(() => !cancelled && setRes({ q: needle, data: null, failed: true }));
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [needle, searching]);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t("admin.shell.copied"));
      } catch {
        toast.error(t("admin.palette.copyFailed"));
      }
    },
    [toast, t],
  );

  const hits = useMemo<Hit[]>(() => {
    const low = needle.toLowerCase();
    const match = (h: Hit) => !low || h.label.toLowerCase().includes(low) || !!h.sub?.toLowerCase().includes(low);
    const out: Hit[] = [];

    if (!low)
      for (const s of shell.prefs.recentSearches.slice(0, 5))
        out.push({ id: `recent:${s}`, group: "recent", label: s, icon: History, keepOpen: true, run: () => setQ(s) });

    // Context: actions for the page the admin is on.
    const ctxHits: Hit[] = [{ id: "ctx:copyLink", group: "context", label: t("admin.palette.ctx.copyLink"), icon: Clipboard, run: () => void copy(window.location.href) }];
    const id = path.match(UUID)?.[0];
    if (id) {
      ctxHits.push({ id: "ctx:copyId", group: "context", label: t("admin.palette.ctx.copyId"), sub: id, icon: Clipboard, run: () => void copy(id) });
      if (shell.can(AUDIT)) ctxHits.push({ id: "ctx:audit", group: "context", label: t("admin.palette.ctx.auditTrail"), sub: id, icon: ScrollText, href: `${base}/audit?resource=${id}` });
    }
    const page = navEntryFor(path);
    if (page) {
      const fav = path || "/";
      const on = shell.prefs.favorites.includes(fav);
      ctxHits.push({ id: "ctx:fav", group: "context", label: on ? t("admin.palette.ctx.unfavorite") : t("admin.palette.ctx.favorite"), sub: t(page.item.label), icon: Star, run: () => shell.toggleFavorite(fav) });
    }
    ctxHits.push(
      { id: "ctx:sidebar", group: "context", label: shell.prefs.collapsed ? t("admin.shell.expandSidebar") : t("admin.shell.collapseSidebar"), sub: "[", icon: PanelLeft, run: () => shell.setCollapsed(!shell.prefs.collapsed) },
      { id: "ctx:density", group: "context", label: shell.prefs.density === "compact" ? t("admin.palette.ctx.comfortable") : t("admin.palette.ctx.compact"), icon: Rows3, run: () => shell.setDensity(shell.prefs.density === "compact" ? "comfortable" : "compact") },
      { id: "ctx:help", group: "context", label: t("admin.palette.ctx.shortcuts"), sub: "?", icon: Keyboard, run: () => setHelp(true) },
    );

    // Sources (quick commands always; live result groups while searching).
    const ctx: PaletteContext = { t, base, needle, low, data, controls, can: shell.can, path };
    const sourced: Hit[] = [];
    for (const src of PALETTE_SOURCES) {
      if (!low && src.group !== "quick") continue;
      for (const h of src.hits(ctx)) sourced.push({ ...h, group: src.group });
    }

    const nav: Hit[] = visibleNav(shell.perms).flatMap((s): Hit[] => [
      { id: `nav:${s.id}`, group: "nav", label: t(s.label), href: `${base}${s.href}`, icon: s.icon },
      ...(s.children ?? []).filter((c) => c.href !== s.href).map((c) => ({ id: `nav:${s.id}:${c.id}`, group: "nav", label: t(c.label), sub: t(s.label), href: `${base}${c.href}`, icon: s.icon })),
    ]);

    if (!low) out.push(...sourced, ...ctxHits, ...nav);
    else {
      out.push(...nav.filter(match).slice(0, 6), ...sourced, ...ctxHits.filter(match));
      if (low.length >= 2) out.push({ id: "all", group: "all", label: t("admin.search.seeAll", { q: needle }), href: `${base}/search?q=${encodeURIComponent(needle)}`, icon: Search });
    }
    return out;
  }, [needle, data, controls, base, t, shell, path, copy]);

  const current = Math.min(active, Math.max(0, hits.length - 1));

  const go = useCallback(
    (h: Hit | undefined) => {
      if (!h) return;
      if (needle.length >= 2 && h.group !== "context" && h.group !== "recent") shell.rememberSearch(needle);
      if (!h.keepOpen) setOpen(false);
      if (h.run) h.run();
      else if (h.href) router.push(h.href);
    },
    [router, needle, shell],
  );

  const groupLabel: Record<string, string> = {
    recent: t("admin.palette.groups.recent"),
    context: t("admin.palette.groups.context"),
    nav: t("admin.search.groups.nav"),
    ...Object.fromEntries(PALETTE_SOURCES.map((src) => [src.group, t(src.label)])),
    all: t("admin.search.groups.more"),
  };
  const groups = [...new Set(hits.map((h) => h.group))];
  const activeId = hits[current] ? `${listId}-${current}` : undefined;
  const liveGroups = hits.filter((h) => !["nav", "all", "context", "quick", "recent"].includes(h.group)).length;

  return (
    <>
      <D.Root
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQ("");
          setActive(0);
        }}
      >
        <D.Trigger asChild>
          <button
            type="button"
            className="group relative flex h-8 w-full max-w-sm items-center gap-2 rounded-md border bg-surface ps-2.5 pe-2 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2"
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
              {loading ? <Loader2 className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden /> : <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
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
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive(Math.min(hits.length - 1, current + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive(Math.max(0, current - 1));
                  } else if (e.key === "Home" && !q) {
                    setActive(0);
                  } else if (e.key === "End" && !q) {
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
                <div key={g} role="group" aria-label={groupLabel[g] ?? g} className="mb-1">
                  <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{groupLabel[g] ?? g}</div>
                  {hits.map((h, i) =>
                    h.group === g ? (
                      <div
                        key={h.id}
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={i === current}
                        onMouseMove={() => setActive(i)}
                        onClick={() => go(h)}
                        className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm", i === current ? "bg-accent text-accent-foreground" : "text-foreground")}
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
              {failed ? <p className="px-2 py-3 text-center text-xs text-danger">{t("admin.palette.searchFailed")}</p> : null}
              {needle.length >= 2 && !loading && data && liveGroups === 0 ? <p className="px-2 py-4 text-center text-sm text-muted-foreground">{t("common.noResults")}</p> : null}
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
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border px-1 font-mono">?</kbd>
                {t("admin.palette.ctx.shortcuts")}
              </span>
              <span className="ms-auto">{t("admin.search.scopeNote")}</span>
            </div>
          </D.Content>
        </D.Portal>
      </D.Root>
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
    </>
  );
}
