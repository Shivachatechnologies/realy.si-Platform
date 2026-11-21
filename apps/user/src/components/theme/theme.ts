/**
 * App colour theme (no "use client": the root layout reads it on the server).
 *   "jarvis" (default) → data-theme="dark" on <html>: the JARVIS deep-navy theme.
 *   "light"            → data-theme="light".
 *   "system"           → no data-theme: follows the OS (prefers-color-scheme).
 * Stored in a first-party cookie so the server renders the right theme on the first byte (no flash).
 */
export const THEME_COOKIE = "realy_theme";
export const THEMES = ["jarvis", "light", "system"] as const;
export type ThemeChoice = (typeof THEMES)[number];

export function parseTheme(v: string | undefined | null): ThemeChoice {
  return v === "light" || v === "system" ? v : "jarvis";
}

export function themeAttr(choice: ThemeChoice): "dark" | "light" | undefined {
  return choice === "jarvis" ? "dark" : choice === "light" ? "light" : undefined;
}

/** Browser chrome colour per theme (iOS status bar / Android toolbar). */
export const THEME_COLOR = { dark: "#060a13", light: "#f4f6fa" } as const;
