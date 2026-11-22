import enUS from "@/i18n/messages/en-US.json";
import { createTranslatorCore, type Translate } from "./translate-core";

export { lookup, mergeMessages, namespaceOf, type MessageTree, type Translate, type TranslateValues } from "./translate-core";
export type Messages = typeof enUS;

/**
 * Build a translator for one locale (server side: the full catalogs are available). ICU MessageFormat (plurals,
 * selects, number/date args). Missing keys fall back to en-US, then to the key itself (never crash a page over a
 * string). Client components get theirs from `I18nProvider` (./client.tsx), which never imports a catalog.
 */
export function createTranslator(locale: string, messages: unknown): Translate {
  return createTranslatorCore(locale, messages, enUS);
}
