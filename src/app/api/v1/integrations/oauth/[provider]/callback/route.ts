import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/core/env";
import { userContext } from "@/server/core/context";
import { clientIp } from "@/server/core/http";
import { isAppError } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { captureException } from "@/server/core/telemetry";
import { SESSION_COOKIE, validateSessionToken } from "@/server/modules/auth/session";
import { INTEGRATION_OAUTH_COOKIE, INTEGRATION_OAUTH_COOKIE_PATH, IntegrationOAuthError, readIntegrationState } from "@/server/modules/integrations/oauth";
import { ProviderError } from "@/server/modules/integrations/providers";
import { completeOAuthConnection } from "@/server/modules/integrations/service";
import { closestLocale } from "@/i18n/config";

/** Provider redirect target: {APP_URL}/api/v1/integrations/oauth/{provider}/callback */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/v1/integrations/oauth/[provider]/callback">) {
  const { provider } = await ctx.params;
  const q = req.nextUrl.searchParams;
  const app = env().APP_URL;
  const safeProvider = /^[a-z_]{1,40}$/.test(provider) ? provider : "unknown";
  let locale = "en-US";
  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`/${locale}/integrations/${safeProvider}?${query}`, app));
    res.cookies.set(INTEGRATION_OAUTH_COOKIE, "", { path: INTEGRATION_OAUTH_COOKIE_PATH, maxAge: 0 });
    return res;
  };
  try {
    const state = readIntegrationState(req.cookies.get(INTEGRATION_OAUTH_COOKIE)?.value, provider, q.get("state"));
    locale = closestLocale(state.locale);
    if (q.get("error") || !q.get("code")) return done(`oauthError=${q.get("error") === "access_denied" ? "access_denied" : "provider_error"}`);
    const session = await validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
    if (!session || session.mfaPending || session.userId !== state.userId) return done("oauthError=state_mismatch");
    const requestCtx = userContext(session.userId, { ip: clientIp(req), userAgent: req.headers.get("user-agent"), sessionId: session.id, mfaVerifiedAt: session.mfaVerifiedAt });
    await completeOAuthConnection(requestCtx, state, q.get("code")!, { realmId: q.get("realmId") });
    return done("connected=1");
  } catch (err) {
    if (err instanceof IntegrationOAuthError) return done(`oauthError=${err.code}`);
    if (isAppError(err)) return done(`oauthError=${err.code === "forbidden" ? "forbidden" : "provider_error"}`);
    if (!(err instanceof ProviderError)) {
      logger.error({ provider: safeProvider, err: err instanceof Error ? err.message : "error" }, "integration oauth callback failed");
      captureException(err, { provider: safeProvider });
    }
    return done("oauthError=provider_error");
  }
}
