"use client";

import { useSyncExternalStore } from "react";
import { Palette } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { setCookie } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { parseTheme, THEME_COLOR, THEME_COOKIE, THEMES, themeAttr, type ThemeChoice } from "./theme";

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
function current(): ThemeChoice {
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${THEME_COOKIE}=`));
  return parseTheme(m ? decodeURIComponent(m.slice(THEME_COOKIE.length + 1)) : null);
}

/** Choose the app look: JARVIS (dark, default), Light, or follow the system. Applies instantly, remembered per browser. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { t } = useI18n();
  const value = useSyncExternalStore(subscribe, current, () => "jarvis" as ThemeChoice);

  function change(next: ThemeChoice) {
    setCookie(THEME_COOKIE, next);
    listeners.forEach((l) => l());
    const attr = themeAttr(next);
    const root = document.documentElement;
    if (attr) root.dataset.theme = attr;
    else delete root.dataset.theme;
    const dark = attr ? attr === "dark" : window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light));
  }

  return (
    <span className={cn("relative inline-flex items-center gap-1.5 text-muted-foreground", className)}>
      <Palette className="size-4" aria-hidden />
      <select
        aria-label={t("shell.theme.label")}
        value={value}
        onChange={(e) => change(parseTheme(e.target.value))}
        className="cursor-pointer appearance-none bg-transparent pe-1 text-xs hover:text-foreground focus-visible:outline-none"
      >
        {THEMES.map((k) => (
          <option key={k} value={k}>
            {t(`shell.theme.${k}`)}
          </option>
        ))}
      </select>
    </span>
  );
}
