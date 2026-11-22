import { NextResponse } from "next/server";
import { isAppLocale } from "@/i18n/config";
import { clientIp, route } from "@/server/core/http";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/modules/auth/session";
import { redeemImpersonationToken } from "@/server/modules/admin/impersonation";

/**
 * Redeem a one-time impersonation link minted by the Control Center (stream B, modules/admin/impersonation.ts):
 * the token becomes a time-boxed user-app session marked with impersonatorId / impersonationId, then the browser goes
 * to the Command Center where the impersonation banner is shown. Unusable links go to sign-in with a notice. The
 * token is single-use, valid for 2 minutes, and never stored (only its SHA-256).
 */
export const GET = route<{ locale: string; token: string }>(
  { auth: "none", name: "GET /impersonate/:token", rateLimits: [{ name: "impersonate:ip", limit: 20, windowMs: 60_000, by: "ip", sensitive: true }] },
  async ({ req, requestId }, { locale, token }) => {
    const loc = isAppLocale(locale) ? locale : "en-US";
    const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
    try {
      const r = await redeemImpersonationToken(token, { ip: clientIp(req), userAgent: req.headers.get("user-agent"), requestId });
      const res = NextResponse.redirect(new URL(`/${loc}`, req.url), { status: 303, headers });
      res.cookies.set(SESSION_COOKIE, r.sessionToken, sessionCookieOptions(r.expiresAt));
      return res;
    } catch {
      return NextResponse.redirect(new URL(`/${loc}/sign-in?impersonation=invalid`, req.url), { status: 303, headers });
    }
  },
);
