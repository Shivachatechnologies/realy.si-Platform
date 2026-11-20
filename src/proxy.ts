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

const SESSION_COOKIE = "realy_session";

/**
 * Deployment surface (docs/architecture.md): the same codebase deploys twice — APP_SURFACE=user (company app,
 * e.g. app.realy.si) and APP_SURFACE=admin (platform admin console, e.g. admin.realy.si). Unset serves both.
 * Session cookies are host-only, so each subdomain has its own login.
 */
type Surface = "admin" | "user" | "all";
const surface = (): Surface => (process.env.APP_SURFACE === "admin" || process.env.APP_SURFACE === "user" ? process.env.APP_SURFACE : "all");

/** Pages the admin surface serves besides /admin/**: MFA and password recovery for admin accounts. */
const ADMIN_SURFACE_SHARED = new Set(["mfa", "forgot-password", "reset-password", "verify-email"]);

function surfaceRedirect(req: NextRequest, locale: string, rest: string[]): NextResponse | null {
  const mode = surface();
  const isAdminPath = rest[0] === "admin";
  if (mode === "user" && isAdminPath) {
    const adminUrl = process.env.ADMIN_URL;
    if (adminUrl) return NextResponse.redirect(new URL(`/${locale}/${rest.join("/")}`, adminUrl));
    return NextResponse.rewrite(new URL(`/${locale}/not-found-surface`, req.url), { status: 404 });
  }
  if (mode === "admin" && !isAdminPath && !ADMIN_SURFACE_SHARED.has(rest[0] ?? "")) {
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}/admin`;
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Admin pages without a session go to the admin login (not the user sign-in).
  if (isAdminPath && rest[1] !== "login" && !req.cookies.get(SESSION_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}/admin/login`;
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return null;
}

/** API: each surface only exposes its own admin API. */
function apiSurfaceBlock(pathname: string): NextResponse | null {
  const mode = surface();
  const adminApi = pathname.startsWith("/api/v1/admin/") || pathname === "/api/v1/admin";
  if ((mode === "user" && adminApi) || (mode === "admin" && pathname.startsWith("/api/v1/organizations/"))) {
    return NextResponse.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
  }
  return null;
}

/**
 * 1. Locale-prefix routing. 2. Per-request CSP nonce: Next.js reads the nonce from the request's CSP
 *    header and applies it to the scripts it renders (docs/security.md §4).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) return apiSurfaceBlock(pathname) ?? NextResponse.next();
  const [, first = "", ...rest] = pathname.split("/");
  if (!isAppLocale(first)) {
    const url = req.nextUrl.clone();
    const locale = preferredLocale(req);
    url.pathname = surface() === "admin" && pathname === "/" ? `/${locale}/admin` : `/${locale}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url);
  }
  const blocked = surfaceRedirect(req, first, rest.filter(Boolean));
  if (blocked) return blocked;
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
    // Admin API vs company API, per deployment surface.
    "/api/v1/admin/:path*",
    "/api/v1/organizations/:path*",
    {
      source: "/((?!api|_next|.*\\..*).*)",
      // Prefetches don't render scripts that need the nonce of a later navigation.
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
