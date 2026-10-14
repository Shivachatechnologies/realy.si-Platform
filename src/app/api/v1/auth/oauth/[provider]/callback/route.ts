import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/core/env";
import { newRequestId } from "@/server/core/context";
import { clientIp } from "@/server/core/http";
import { logger } from "@/server/core/logger";
import { captureException } from "@/server/core/telemetry";
import { SESSION_COOKIE, sessionCookieOptions, validateSessionToken } from "@/server/modules/auth/session";
import { completeOAuth, isOAuthProvider, OAUTH_COOKIE, OAuthError, readStateCookie } from "@/server/modules/auth/oauth";
import { closestLocale } from "@/i18n/config";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/v1/auth/oauth/[provider]/callback">) {
  const { provider } = await ctx.params;
  const q = req.nextUrl.searchParams;
  const app = env().APP_URL;
  const clear = (res: NextResponse) => {
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/v1/auth/oauth", maxAge: 0 });
    return res;
  };
  let locale = "en-US";
  let mode: "login" | "link" = "login";
  const fail = (code: string) =>
    clear(NextResponse.redirect(new URL(mode === "link" ? `/${locale}/settings/security?oauthError=${code}&provider=${provider}` : `/${locale}/sign-in?oauthError=${code}&provider=${provider}`, app)));

  if (!isOAuthProvider(provider)) return fail("not_configured");
  try {
    const state = readStateCookie(req.cookies.get(OAUTH_COOKIE)?.value, provider, q.get("state"));
    locale = closestLocale(state.locale);
    mode = state.mode;
    if (q.get("error") || !q.get("code")) return fail("provider_error");
    const session = await validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
    const requestCtx = { requestId: newRequestId(null), actor: { type: "USER" as const, id: null }, mfaVerifiedAt: null, sessionId: null, ip: clientIp(req), userAgent: req.headers.get("user-agent") };
    const result = await completeOAuth(requestCtx, state, q.get("code")!, session?.userId ?? null);
    if (result.kind === "linked") return clear(NextResponse.redirect(new URL(`/${locale}/settings/security?oauth=linked`, app)));
    const target = result.mfaRequired
      ? `/${locale}/mfa${result.next ? `?next=${encodeURIComponent(result.next)}` : ""}`
      : (result.next ?? (result.created ? `/${locale}/onboarding` : `/${locale}`));
    const res = clear(NextResponse.redirect(new URL(target, app)));
    res.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
    return res;
  } catch (err) {
    if (err instanceof OAuthError) return fail(err.code);
    logger.error({ err: (err as Error).message, provider }, "oauth callback failed");
    captureException(err, { provider });
    return fail("provider_error");
  }
}
