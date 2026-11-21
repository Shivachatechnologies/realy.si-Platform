"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { Aurora } from "@/components/motion/aurora";
import { PageTransition } from "@/components/motion/page-transition";
import { Sidebar } from "./sidebar";
import { MobileCommandEntry, MobileTabBar } from "./mobile-nav";
import { JarvisDock } from "@/components/jarvis/jarvis-dock";

export { Aurora };

/* Desktop rail preference, remembered per browser (a convenience only; the shell renders expanded without it). */
const RAIL_KEY = "realy.sidebar.collapsed";
const railListeners = new Set<() => void>();
function readRail(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}
function writeRail(v: boolean) {
  try {
    window.localStorage.setItem(RAIL_KEY, v ? "1" : "0");
  } catch {
    /* storage unavailable: the toggle still works for this page view */
  }
  railCache = v;
  railListeners.forEach((l) => l());
}
let railCache: boolean | null = null;
const subscribeRail = (cb: () => void) => {
  railListeners.add(cb);
  return () => railListeners.delete(cb);
};
const getRail = () => (railCache ??= readRail());

/**
 * Responsive frame: glass sidebar (collapsible rail on desktop, slide-over drawer below lg), glass topbar, the aurora canvas
 * and, below lg, a bottom tab bar with a sticky AI command entry. Safe-area insets keep it clear of notches and the home
 * indicator.
 * `activity` is an optional slot rendered at the end of the topbar (e.g. <AiActivityIndicator running={n} />).
 * Logical properties keep it correct in RTL.
 */
export function AppFrame({ topbar, adminSlot, activity, lockedHrefs, children }: { topbar: ReactNode; adminSlot?: ReactNode; activity?: ReactNode; lockedHrefs?: string[]; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeRail, getRail, () => false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    // Lock page scroll behind the open drawer (restored on close).
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      root.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="relative isolate flex min-h-dvh" data-app-frame>
      <Aurora />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-elev-3"
      >
        {t("common.skipToContent")}
      </a>

      {/* Desktop rail */}
      <aside
        className={cn(
          "glass sticky top-0 z-20 hidden h-dvh shrink-0 border-e transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] lg:block",
          collapsed ? "w-[3.75rem]" : "w-60",
        )}
      >
        <Sidebar adminSlot={adminSlot} lockedHrefs={lockedHrefs} collapsed={collapsed} onToggleCollapsed={() => writeRail(!collapsed)} />
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-[oklch(0.12_0.02_275/0.45)] backdrop-blur-[2px] transition-opacity duration-300 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <aside
        className={cn(
          "glass-strong fixed inset-y-0 start-0 z-50 w-80 max-w-[86vw] border-e pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-elev-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none lg:hidden",
          open ? "translate-x-0" : "-translate-x-full rtl:translate-x-full",
        )}
        aria-hidden={!open}
        inert={!open}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute end-2 top-[calc(0.375rem+env(safe-area-inset-top))] z-10 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("shell.closeNavigation")}
        >
          <X className="size-5" aria-hidden />
        </button>
        <Sidebar adminSlot={adminSlot} lockedHrefs={lockedHrefs} onNavigate={() => setOpen(false)} touch />
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-2 border-b ps-[max(0.75rem,env(safe-area-inset-left))] pe-[max(0.75rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] lg:px-5">
          <button
            type="button"
            className="hidden size-10 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:grid lg:hidden"
            onClick={() => setOpen(true)}
            aria-label={t("common.toggleNavigation")}
            aria-expanded={open}
          >
            <Menu className="size-5" aria-hidden />
          </button>
          {topbar}
          {activity ? <div className="hidden shrink-0 items-center border-s ps-3 md:flex">{activity}</div> : null}
        </header>
        <main
          id="main"
          className="min-w-0 flex-1 ps-[max(0.75rem,env(safe-area-inset-left))] pe-[max(0.75rem,env(safe-area-inset-right))] pt-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:px-6 lg:py-6"
        >
          <PageTransition>{children}</PageTransition>
        </main>
      </div>

      {/* Phones and tablets: bottom tab bar (+ "More" opens the drawer) and the sticky AI command entry. */}
      <MobileTabBar onMore={() => setOpen(true)} moreOpen={open} lockedHrefs={lockedHrefs} />
      <MobileCommandEntry />
      {/* Realy voice dock (components/jarvis): idle until opened or the "Hey Realy" wake word is switched on. */}
      <JarvisDock />
    </div>
  );
}
