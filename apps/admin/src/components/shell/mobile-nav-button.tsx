"use client";

import { Menu } from "lucide-react";
import { useT } from "@/i18n/client";
import { useShell } from "./shell-context";

/** Opens the navigation drawer on small screens. */
export function MobileNavButton() {
  const t = useT();
  const { setDrawerOpen } = useShell();
  return (
    <button type="button" onClick={() => setDrawerOpen(true)} aria-label={t("admin.shell.openNavigation")} className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 lg:hidden">
      <Menu className="size-4" aria-hidden />
    </button>
  );
}
