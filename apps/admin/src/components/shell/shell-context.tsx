"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BreadcrumbItem } from "@/components/ui/breadcrumbs";
import { api } from "@/lib/api-client";

/**
 * Console shell state shared by the top bar, sidebar, palette and breadcrumbs (stream A): the admin's platform
 * permissions (UI hints only), persisted preferences (favorites, sidebar collapse, density), sidebar badge counts,
 * the mobile drawer and per-page breadcrumb extras. Preference writes go to /api/v1/admin/me/* (own row only).
 */
export interface ShellPrefs {
  favorites: string[];
  recents: { href: string; label: string; at: string }[];
  recentSearches: string[];
  collapsed: boolean;
  groups: Record<string, boolean>;
  density: "comfortable" | "compact";
  timeRange: string;
}

interface ShellValue {
  perms: ReadonlySet<string>;
  can: (perms: readonly string[]) => boolean;
  badges: Record<string, number>;
  prefs: ShellPrefs;
  setCollapsed: (v: boolean) => void;
  setGroupOpen: (id: string, open: boolean) => void;
  toggleFavorite: (href: string) => void;
  setDensity: (d: ShellPrefs["density"]) => void;
  rememberSearch: (q: string) => void;
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
  crumbs: BreadcrumbItem[];
  setCrumbs: (items: BreadcrumbItem[]) => void;
}

const ShellContext = createContext<ShellValue | null>(null);

const quiet = (p: Promise<unknown>) => p.catch(() => undefined);

export function ShellProvider({ perms, badges, prefs: initial, children }: { perms: string[]; badges: Record<string, number>; prefs: ShellPrefs; children: ReactNode }) {
  const [prefs, setPrefs] = useState(initial);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [crumbs, setCrumbs] = useState<BreadcrumbItem[]>([]);
  const permSet = useMemo(() => new Set(perms), [perms]);
  const latest = useRef(prefs);
  useEffect(() => {
    latest.current = prefs;
  }, [prefs]);
  const can = useCallback((p: readonly string[]) => p.length === 0 || p.some((k) => permSet.has(k)), [permSet]);

  const setCollapsed = useCallback((collapsed: boolean) => {
    setPrefs((p) => ({ ...p, collapsed }));
    void quiet(api("/api/v1/admin/me/preferences", { method: "PATCH", body: { sidebar: { collapsed } } }));
  }, []);
  const setGroupOpen = useCallback((id: string, open: boolean) => {
    setPrefs((p) => ({ ...p, groups: { ...p.groups, [id]: open } }));
    void quiet(api("/api/v1/admin/me/preferences", { method: "PATCH", body: { sidebar: { groups: { [id]: open } } } }));
  }, []);
  const toggleFavorite = useCallback((href: string) => {
    const on = !latest.current.favorites.includes(href);
    setPrefs((p) => ({ ...p, favorites: on ? [href, ...p.favorites.filter((f) => f !== href)] : p.favorites.filter((f) => f !== href) }));
    void quiet(api("/api/v1/admin/me/favorites", { method: "POST", body: { href, on } }));
  }, []);
  const setDensity = useCallback((density: ShellPrefs["density"]) => {
    setPrefs((p) => ({ ...p, density }));
    document.querySelector("[data-surface=admin]")?.setAttribute("data-density", density);
    void quiet(api("/api/v1/admin/me/preferences", { method: "PATCH", body: { density } }));
  }, []);
  const rememberSearch = useCallback((q: string) => {
    const query = q.trim();
    if (query.length < 2) return;
    setPrefs((p) => ({ ...p, recentSearches: [query, ...p.recentSearches.filter((s) => s.toLowerCase() !== query.toLowerCase())].slice(0, 10) }));
    void quiet(api("/api/v1/admin/me/recent-searches", { method: "POST", body: { q: query } }));
  }, []);

  const value = useMemo<ShellValue>(
    () => ({ perms: permSet, can, badges, prefs, setCollapsed, setGroupOpen, toggleFavorite, setDensity, rememberSearch, drawerOpen, setDrawerOpen, crumbs, setCrumbs }),
    [permSet, can, badges, prefs, setCollapsed, setGroupOpen, toggleFavorite, setDensity, rememberSearch, drawerOpen, crumbs],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

const FALLBACK: ShellValue = {
  perms: new Set(),
  can: (p) => p.length === 0,
  badges: {},
  prefs: { favorites: [], recents: [], recentSearches: [], collapsed: false, groups: {}, density: "comfortable", timeRange: "30d" },
  setCollapsed: () => {},
  setGroupOpen: () => {},
  toggleFavorite: () => {},
  setDensity: () => {},
  rememberSearch: () => {},
  drawerOpen: false,
  setDrawerOpen: () => {},
  crumbs: [],
  setCrumbs: () => {},
};

/** Shell state; outside the console shell (tests, auth pages) a harmless fallback. */
export function useShell(): ShellValue {
  return useContext(ShellContext) ?? FALLBACK;
}

/** True when keyboard focus is in a text field (single-key shortcuts must not fire there). */
export function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}
