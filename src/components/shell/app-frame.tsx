"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { Aurora } from "@/components/motion/aurora";
import { PageTransition } from "@/components/motion/page-transition";
import { Sidebar } from "./sidebar";

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
 * Responsive frame: glass sidebar (collapsible rail on desktop, drawer on mobile), glass topbar and the aurora canvas.
 * `activity` is an optional slot rendered at the end of the topbar (e.g. <AiActivityIndicator running={n} />).
 * Logical properties keep it correct in RTL.
 */
export function AppFrame({ topbar, adminSlot, activity, children }: { topbar: ReactNode; adminSlot?: ReactNode; activity?: ReactNode; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeRail, getRail, () => false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative isolate flex min-h-dvh">
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
        <Sidebar adminSlot={adminSlot} collapsed={collapsed} onToggleCollapsed={() => writeRail(!collapsed)} />
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
          "glass-strong fixed inset-y-0 start-0 z-50 w-72 max-w-[85vw] border-e shadow-elev-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] lg:hidden",
          open ? "translate-x-0" : "-translate-x-full rtl:translate-x-full",
        )}
        aria-hidden={!open}
        inert={!open}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute end-2 top-3 z-10 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("shell.closeNavigation")}
        >
          <X className="size-4" aria-hidden />
        </button>
        <Sidebar adminSlot={adminSlot} onNavigate={() => setOpen(false)} />
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 lg:px-5">
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            onClick={() => setOpen(true)}
            aria-label={t("common.toggleNavigation")}
            aria-expanded={open}
          >
            <Menu className="size-5" aria-hidden />
          </button>
          {topbar}
          {activity ? <div className="hidden shrink-0 items-center border-s ps-3 md:flex">{activity}</div> : null}
        </header>
        <main id="main" className="min-w-0 flex-1 px-3 py-5 lg:px-6 lg:py-6">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
