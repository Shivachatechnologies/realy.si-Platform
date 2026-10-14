"use client";

import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { Sidebar } from "./sidebar";

/** Responsive frame: fixed sidebar on desktop, drawer on mobile. Logical properties keep it correct in RTL. */
export function AppFrame({ topbar, adminSlot, children }: { topbar: ReactNode; adminSlot?: ReactNode; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        {t("common.skipToContent")}
      </a>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-e bg-surface lg:block">
        <Sidebar adminSlot={adminSlot} />
      </aside>
      {open ? <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden /> : null}
      <aside
        className={cn(
          "fixed inset-y-0 start-0 z-50 w-64 border-e bg-surface transition-transform lg:hidden",
          open ? "translate-x-0" : "-translate-x-full rtl:translate-x-full",
        )}
        aria-hidden={!open}
      >
        <Sidebar adminSlot={adminSlot} onNavigate={() => setOpen(false)} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur lg:px-5">
          <button type="button" className="rounded-md p-1.5 hover:bg-muted lg:hidden" onClick={() => setOpen(true)} aria-label={t("common.toggleNavigation")}>
            <Menu className="size-5" />
          </button>
          {topbar}
        </header>
        <main id="main" className="min-w-0 flex-1 px-3 py-5 lg:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
