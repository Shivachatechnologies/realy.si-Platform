import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/server/core/env";
import { userContext } from "@/server/core/context";
import { clientIp } from "@/server/core/http";
import { consume } from "@/server/core/rate-limit";
import { LIMITS } from "@/server/core/limits";
import { isAppError } from "@/server/core/errors";
import { SESSION_COOKIE, validateSessionToken } from "@/server/modules/auth/session";
import { INTEGRATION_OAUTH_COOKIE, INTEGRATION_OAUTH_COOKIE_PATH } from "@/server/modules/integrations/oauth";
import { startOAuthConnection } from "@/server/modules/integrations/service";
import { closestLocale } from "@/i18n/config";

const uuid = z.string().uuid();

/** Browser navigation from the integration page: redirects to the provider's consent screen (or back with an error code). */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/v1/integrations/oauth/[provider]/start">) {
  const { provider } = await ctx.params;
  const q = req.nextUrl.searchParams;
  const locale = closestLocale(q.get("locale"));
  const safeProvider = /^[a-z_]{1,40}$/.test(provider) ? provider : "unknown";
  const back = (code: string) => NextResponse.redirect(new URL(`/${locale}/integrations/${safeProvider}?oauthError=${code}`, env().APP_URL));

  const orgId = q.get("orgId") ?? "";
  const companyId = q.get("companyId") ?? "";
  if (!uuid.safeParse(orgId).success || !uuid.safeParse(companyId).success) return back("invalid_request");
  const limit = await consume(LIMITS.oauth[0], clientIp(req) ?? "no-ip");
  if (!limit.allowed) return back("rate_limited");
  const session = await validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session || session.mfaPending) return NextResponse.redirect(new URL(`/${locale}/sign-in`, env().APP_URL));
  try {
    const requestCtx = userContext(session.userId, { ip: clientIp(req), userAgent: req.headers.get("user-agent"), sessionId: session.id, mfaVerifiedAt: session.mfaVerifiedAt });
    // Per-account endpoints (Zendesk subdomain, Shopify shop) are named on the integration page before the redirect.
    const params = { subdomain: q.get("subdomain") ?? undefined, shopDomain: q.get("shopDomain") ?? undefined };
    const { url, cookie, maxAgeSeconds } = await startOAuthConnection(requestCtx, orgId, companyId, provider, locale, params);
    const res = NextResponse.redirect(url);
    // Lax: the provider's redirect back is a top-level GET navigation, which Lax cookies accompany.
    res.cookies.set(INTEGRATION_OAUTH_COOKIE, cookie, { httpOnly: true, secure: env().NODE_ENV === "production", sameSite: "lax", path: INTEGRATION_OAUTH_COOKIE_PATH, maxAge: maxAgeSeconds });
    return res;
  } catch (err) {
    return back(isAppError(err) ? (err.code === "not_configured" ? "not_configured" : err.code === "forbidden" ? "forbidden" : err.details?.reason === "integrations_connect_param_invalid" ? "invalid_account" : "invalid_request") : "provider_error");
  }
}
