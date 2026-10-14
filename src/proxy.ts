import { NextResponse, type NextRequest } from "next/server";
import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, isAppLocale } from "@/i18n/config";
import { buildCsp, newNonce } from "@/server/core/security-headers";

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

/**
 * 1. Locale-prefix routing. 2. Per-request CSP nonce: Next.js reads the nonce from the request's CSP
 *    header and applies it to the scripts it renders (docs/security.md §4).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const first = pathname.split("/")[1] ?? "";
  if (!isAppLocale(first)) {
    const url = req.nextUrl.clone();
    url.pathname = `/${preferredLocale(req)}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url);
  }
  const nonce = newNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== "production" });
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: [
    {
      source: "/((?!api|_next|.*\\..*).*)",
      // Prefetches don't render scripts that need the nonce of a later navigation.
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
