import { NextResponse } from "next/server";
import { isAppLocale } from "@/i18n/config";
import { clientIp, route } from "@/server/core/http";
import { env } from "@/server/core/env";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/modules/auth/session";
import { endImpersonationForSession } from "@/server/modules/admin/impersonation";

/**
 * "End impersonation" from the user-app banner (a plain form POST; route() enforces the same-origin check). Ends the
 * impersonation behind the current session (audited as the impersonating admin), clears the cookie and returns to the
 * Control Center user page when ADMIN_URL is known. The `[token]` segment carries the impersonation id (informational:
 * the session decides what is ended).
 */
export const POST = route<{ locale: string; token: string }>({ auth: "mfa-pending", name: "POST /impersonate/:id/end" }, async ({ req, session, requestId }, { locale }) => {
  const loc = isAppLocale(locale) ? locale : "en-US";
  const ended = await endImpersonationForSession(session!.id, { ip: clientIp(req), userAgent: req.headers.get("user-agent"), requestId });
  const admin = env().ADMIN_URL;
  const target = ended && admin ? new URL(`/${loc}/roles/impersonation`, admin) : new URL(`/${loc}/sign-in`, req.url);
  const res = NextResponse.redirect(target, { status: 303, headers: { "cache-control": "no-store" } });
  // Only an impersonation session is ended here; a normal session is left alone (the banner never renders for it).
  if (ended) res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
  return res;
});
