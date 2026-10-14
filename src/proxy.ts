import { NextResponse, type NextRequest } from "next/server";
import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, isAppLocale } from "@/i18n/config";

/** Resolution order (docs/globalization.md §2): explicit cookie → Accept-Language → en-US. */
function preferredLocale(req: NextRequest): string {
  const cookie = req.cookies.get(LOCALE_COOKIE)?.value;
  if (isAppLocale(cookie)) return cookie;
  const languages = new Negotiator({ headers: { "accept-language": req.headers.get("accept-language") ?? "" } }).languages();
  try {
    return match(languages, [...LOCALES], DEFAULT_LOCALE);
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const first = pathname.split("/")[1] ?? "";
  if (isAppLocale(first)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/${preferredLocale(req)}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
