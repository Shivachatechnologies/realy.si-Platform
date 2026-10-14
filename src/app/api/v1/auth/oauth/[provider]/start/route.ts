import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/core/env";
import { clientIp } from "@/server/core/http";
import { consume } from "@/server/core/rate-limit";
import { LIMITS } from "@/server/core/limits";
import { SESSION_COOKIE, validateSessionToken } from "@/server/modules/auth/session";
import { beginOAuth, isOAuthProvider, OAUTH_COOKIE, OAuthError } from "@/server/modules/auth/oauth";
import { closestLocale } from "@/i18n/config";
import { safeNext } from "@/lib/safe-next";

/** Browser navigation: redirects to the provider, or back to Realy with a localized error code. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/v1/auth/oauth/[provider]/start">) {
  const { provider } = await ctx.params;
  const q = req.nextUrl.searchParams;
  const locale = closestLocale(q.get("locale"));
  const mode = q.get("mode") === "link" ? "link" : "login";
  const back = (code: string) =>
    NextResponse.redirect(new URL(mode === "link" ? `/${locale}/settings/security?oauthError=${code}&provider=${provider}` : `/${locale}/sign-in?oauthError=${code}&provider=${provider}`, env().APP_URL));

  if (!isOAuthProvider(provider)) return back("not_configured");
  const limit = await consume(LIMITS.oauth[0], clientIp(req) ?? "no-ip");
  if (!limit.allowed) return back("provider_error");

  let userId: string | null = null;
  if (mode === "link") {
    const session = await validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
    if (!session || session.mfaPending) return NextResponse.redirect(new URL(`/${locale}/sign-in`, env().APP_URL));
    userId = session.userId;
  }
  try {
    const { url, cookie, maxAgeSeconds } = beginOAuth(provider, { mode, userId, locale, next: safeNext(q.get("next"), "") || null });
    const res = NextResponse.redirect(url);
    // Lax: the provider's redirect back is a top-level GET navigation, which Lax cookies accompany.
    res.cookies.set(OAUTH_COOKIE, cookie, { httpOnly: true, secure: env().NODE_ENV === "production", sameSite: "lax", path: "/api/v1/auth/oauth", maxAge: maxAgeSeconds });
    return res;
  } catch (err) {
    return back(err instanceof OAuthError ? err.code : "provider_error");
  }
}
