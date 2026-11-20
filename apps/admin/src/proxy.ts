import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIES } from "@realy/auth-core";
import { isAppLocale, LOCALE_COOKIE } from "@/i18n/config";
import { negotiateLocale } from "@/i18n/negotiate";
import { buildCsp, newNonce } from "@/server/core/security-headers";
import { verifyConsoleAccess, type ConsoleDenial } from "@/server/modules/admin/console-gate";

/**
 * Control Center proxy (apps/admin, admin.realy.si). There are no public routes: every page and every API request
 * except the sign-in/MFA endpoints, the login and MFA pages and health checks passes verifyConsoleAccess (session of
 * THIS app, MFA complete and fresh, platform role) — server-side, against the database, on every request.
 */
const OPEN_API = [/^\/api\/health(?:\/|$)/, /^\/api\/v1\/auth\/(?:sign-in|sign-out|mfa\/verify)$/];
const OPEN_PAGES = new Set(["login", "mfa"]);

const DENIAL: Record<ConsoleDenial, { status: number; code: string; message: string }> = {
  unauthenticated: { status: 401, code: "unauthenticated", message: "Sign in required" },
  mfa_pending: { status: 401, code: "mfa_required", message: "Complete two-factor verification" },
  mfa_required: { status: 403, code: "mfa_required", message: "A recent two-factor verification is required" },
  forbidden: { status: 403, code: "forbidden", message: "Platform administrators only" },
};

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIES.admin)?.value;

  if (pathname.startsWith("/api/")) {
    if (OPEN_API.some((re) => re.test(pathname))) return NextResponse.next();
    const access = await verifyConsoleAccess(token);
    if (access.ok) return NextResponse.next();
    const d = DENIAL[access.reason];
    return NextResponse.json({ error: { code: d.code, message: d.message } }, { status: d.status, headers: { "cache-control": "no-store" } });
  }

  const [, first = "", ...rest] = pathname.split("/");
  if (!isAppLocale(first)) {
    const url = req.nextUrl.clone();
    const locale = negotiateLocale(req.cookies.get(LOCALE_COOKIE)?.value, req.headers.get("accept-language"));
    // Old single-app URLs (/admin/…) land on the same page of the re-rooted console.
    url.pathname = `/${locale}${pathname.replace(/^\/admin(?=\/|$)/, "").replace(/^\/$/, "")}`;
    return NextResponse.redirect(url);
  }
  const page = rest.filter(Boolean);
  if (page[0] === "admin") {
    const url = req.nextUrl.clone();
    url.pathname = `/${first}${page.length > 1 ? `/${page.slice(1).join("/")}` : ""}`;
    return NextResponse.redirect(url);
  }
  if (!OPEN_PAGES.has(page[0] ?? "")) {
    const access = await verifyConsoleAccess(token);
    if (!access.ok) {
      const url = req.nextUrl.clone();
      url.search = "";
      url.pathname = access.reason === "mfa_pending" || access.reason === "mfa_required" ? `/${first}/mfa` : `/${first}/login`;
      url.searchParams.set("next", pathname);
      if (access.reason === "forbidden") url.searchParams.set("error", "forbidden");
      return NextResponse.redirect(url);
    }
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-realy-path", pathname);
  if (req.headers.has("next-router-prefetch")) return NextResponse.next({ request: { headers: requestHeaders } });
  const nonce = newNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== "production" });
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  // Pages (prefetches included) and the whole API; Next internals and static files excluded.
  matcher: ["/api/:path*", "/((?!api|_next|.*\\..*).*)"],
};
