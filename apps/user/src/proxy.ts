import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIES } from "@realy/auth-core";
import { isAppLocale, LOCALE_COOKIE } from "@/i18n/config";
import { negotiateLocale } from "@/i18n/negotiate";
import { buildCsp, newNonce } from "@/server/core/security-headers";

/**
 * User app proxy (apps/user, app.realy.si):
 *   1. Locale-prefix routing.
 *   2. The Control Center is a separate app (apps/admin, admin.realy.si): legacy /[locale]/admin/** URLs redirect
 *      there when ADMIN_URL is set, otherwise 404. This app has no admin routes and no admin API.
 *   3. Signed-out visitors on the locale root see the public homepage (/[locale]/home, same URL); signed-in users
 *      get the Command Center.
 *   4. Per-request CSP nonce: Next.js reads the nonce from the request's CSP header and applies it to the scripts
 *      it renders (docs/security.md §4).
 * The user session (cookie `realy_session`, @realy/auth-core) is only checked for presence here (public homepage);
 * it is validated by the data access layer (requireViewer / route()). The admin app's cookie is a different,
 * host-only cookie and never reaches this app.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const [, first = "", ...rest] = pathname.split("/");
  if (!isAppLocale(first)) {
    const url = req.nextUrl.clone();
    const locale = negotiateLocale(req.cookies.get(LOCALE_COOKIE)?.value, req.headers.get("accept-language"));
    url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url);
  }
  const page = rest.filter(Boolean);
  if (page[0] === "admin") {
    const adminUrl = process.env.ADMIN_URL;
    if (adminUrl) return NextResponse.redirect(new URL(`/${first}${page.length > 1 ? `/${page.slice(1).join("/")}` : ""}${req.nextUrl.search}`, adminUrl));
    return NextResponse.rewrite(new URL(`/${first}/not-found-admin`, req.url), { status: 404 });
  }
  const publicHome = page.length === 0 && !req.cookies.get(SESSION_COOKIES.user)?.value ? new URL(`/${first}/home`, req.url) : null;
  const forward = (init: { request: { headers: Headers } }) => (publicHome ? NextResponse.rewrite(publicHome, init) : NextResponse.next(init));
  const requestHeaders = new Headers(req.headers);
  // Trusted page path for server-side platform controls (module gate in requireOrgContext); never client-supplied.
  requestHeaders.set("x-realy-path", pathname);
  // Prefetches render no scripts that need this request's nonce; they still get the trusted path.
  if (req.headers.has("next-router-prefetch")) return forward({ request: { headers: requestHeaders } });
  const nonce = newNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== "production" });
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = forward({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  // Everything except API routes, Next internals and files with an extension. Prefetches included: they get the
  // trusted x-realy-path header (but no CSP nonce, see proxy()).
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
