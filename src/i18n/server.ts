import "server-only";
import { notFound } from "next/navigation";
import { locale as localeParam } from "next/root-params";
import { isAppLocale, type AppLocale } from "./config";
import { createTranslator, type Messages, type Translate } from "./translate";

const loaders: Record<AppLocale, () => Promise<Messages>> = {
  "en-US": () => import("./messages/en-US.json").then((m) => m.default),
  "hi-IN": () => import("./messages/hi-IN.json").then((m) => m.default as Messages),
  "ar-AE": () => import("./messages/ar-AE.json").then((m) => m.default as Messages),
  "de-DE": () => import("./messages/de-DE.json").then((m) => m.default as Messages),
  "zh-CN": () => import("./messages/zh-CN.json").then((m) => m.default as Messages),
};

export function getMessages(locale: AppLocale): Promise<Messages> {
  return loaders[locale]();
}

/** The active locale from the `[locale]` root segment (404 for unsupported locales). */
export async function getLocale(): Promise<AppLocale> {
  const value = await localeParam();
  if (!isAppLocale(value)) notFound();
  return value;
}

export async function getT(locale?: AppLocale): Promise<Translate> {
  const l = locale ?? (await getLocale());
  return createTranslator(l, await getMessages(l));
}
