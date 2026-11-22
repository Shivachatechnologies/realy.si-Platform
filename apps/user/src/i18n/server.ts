import "server-only";
import { notFound } from "next/navigation";
import { locale as localeParam } from "next/root-params";
import { isAppLocale, type AppLocale } from "@/i18n/config";
import { createTranslator, type MessageTree, type Translate } from "@/i18n/translate";
import { getMessages, getScopeMessages, LAZY_UNITS } from "./catalog";

export { getMessages, LAZY_UNITS };

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

/**
 * The namespaces one client-message scope sends to the browser (see components/i18n/client-messages.tsx). Server
 * components keep the full catalog through getT/getMessages.
 */
export async function getClientMessages(scope: string, locale?: AppLocale): Promise<MessageTree> {
  return getScopeMessages(locale ?? (await getLocale()), scope);
}
