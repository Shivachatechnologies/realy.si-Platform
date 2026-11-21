/**
 * Worker implementation of the app-provided `@/i18n/server` (docs/architecture/apps.md, "Per-app specifiers").
 * Each Next app supplies its own file; under tsx there is no app, so ./preload.ts points the specifier here. Same
 * exports as apps/user/src/i18n/server.ts, using the user catalogs. There is no `[locale]` route segment in a
 * background job, so a call without an explicit locale gets DEFAULT_LOCALE.
 */
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/i18n/config";
import { createTranslator, type Messages, type Translate } from "@/i18n/translate";

const loaders: Record<AppLocale, () => Promise<Messages>> = {
  "en-US": () => import("@/i18n/messages/en-US.json").then((m) => m.default as Messages),
  "hi-IN": () => import("@/i18n/messages/hi-IN.json").then((m) => m.default as Messages),
  "ar-AE": () => import("@/i18n/messages/ar-AE.json").then((m) => m.default as Messages),
  "de-DE": () => import("@/i18n/messages/de-DE.json").then((m) => m.default as Messages),
  "zh-CN": () => import("@/i18n/messages/zh-CN.json").then((m) => m.default as Messages),
};

export function getMessages(locale: AppLocale): Promise<Messages> {
  return loaders[locale]();
}

export async function getLocale(): Promise<AppLocale> {
  return DEFAULT_LOCALE;
}

export async function getT(locale?: AppLocale): Promise<Translate> {
  const l = locale && isAppLocale(locale) ? locale : DEFAULT_LOCALE;
  return createTranslator(l, await getMessages(l));
}
