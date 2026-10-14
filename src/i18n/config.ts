/**
 * Locales with a shipped message catalog (src/i18n/messages/<tag>.json). Adding a language =
 * add the catalog + its entry here + enable its `locales` row. See docs/globalization.md.
 */
export const LOCALES = ["en-US", "hi-IN", "ar-AE", "de-DE", "zh-CN"] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en-US";
export const LOCALE_COOKIE = "realy_locale";

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

export function directionOf(locale: string): "ltr" | "rtl" {
  return RTL_LANGUAGES.has(locale.split("-")[0]!.toLowerCase()) ? "rtl" : "ltr";
}

/** Map any BCP-47 tag to the closest shipped locale (exact → same language → default). */
export function closestLocale(tag: string | null | undefined): AppLocale {
  if (!tag) return DEFAULT_LOCALE;
  if (isAppLocale(tag)) return tag;
  const lang = tag.split("-")[0]!.toLowerCase();
  return LOCALES.find((l) => l.split("-")[0] === lang) ?? DEFAULT_LOCALE;
}

/** Endonyms shown in the language picker (data, not translatable UI copy). */
export const LOCALE_NAMES: Record<AppLocale, string> = {
  "en-US": "English",
  "hi-IN": "हिन्दी",
  "ar-AE": "العربية",
  "de-DE": "Deutsch",
  "zh-CN": "简体中文",
};
