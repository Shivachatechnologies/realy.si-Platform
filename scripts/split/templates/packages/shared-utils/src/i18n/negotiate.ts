import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import { DEFAULT_LOCALE, LOCALES, isAppLocale, type AppLocale } from "./config";

/**
 * Locale for an unprefixed URL, used by both apps' proxies. Resolution order (docs/globalization.md §2):
 * explicit cookie → Accept-Language → en-US.
 */
export function negotiateLocale(cookieLocale: string | undefined, acceptLanguage: string | null): AppLocale {
  if (isAppLocale(cookieLocale)) return cookieLocale;
  const languages = new Negotiator({ headers: { "accept-language": acceptLanguage ?? "" } }).languages();
  try {
    return match(languages, [...LOCALES], DEFAULT_LOCALE) as AppLocale;
  } catch {
    return DEFAULT_LOCALE;
  }
}
