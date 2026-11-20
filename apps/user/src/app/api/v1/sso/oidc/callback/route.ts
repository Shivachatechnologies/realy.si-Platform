import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/core/env";
import { newRequestId } from "@/server/core/context";
import { clientIp } from "@/server/core/http";
import { logger } from "@/server/core/logger";
import { captureException } from "@/server/core/telemetry";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/modules/auth/session";
import { completeSso, readSsoState, SSO_COOKIE, SsoError } from "@/server/modules/enterprise/sso";
import { closestLocale } from "@/i18n/config";

/** OIDC redirect target: signs in an existing member (session cookie + active organization), or explains why not. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const app = env().APP_URL;
  let locale = "en-US";
  const clear = (res: NextResponse) => {
    res.cookies.set(SSO_COOKIE, "", { path: "/api/v1/sso", maxAge: 0 });
    return res;
  };
  const fail = (code: string) => clear(NextResponse.redirect(new URL(`/${locale}/sso?error=${code}`, app)));
  try {
    const state = readSsoState(req.cookies.get(SSO_COOKIE)?.value, q.get("state"));
    locale = closestLocale(state.locale);
    if (q.get("error") || !q.get("code")) return fail("provider_error");
    const ctx = {
      requestId: newRequestId(null),
      actor: { type: "USER" as const, id: null },
      mfaVerifiedAt: null,
      sessionId: null,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    };
    const result = await completeSso(ctx, state, q.get("code")!);
    const res = clear(NextResponse.redirect(new URL(result.mfaRequired ? `/${locale}/mfa` : `/${locale}`, app)));
    res.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
    res.cookies.set("realy_org", result.organizationId, {
      path: "/",
      sameSite: "lax",
      secure: env().NODE_ENV === "production",
      maxAge: 365 * 86400,
    });
    return res;
  } catch (err) {
    if (err instanceof SsoError) return fail(err.code);
    logger.error({ err: (err as Error).message }, "sso callback failed");
    captureException(err, {});
    return fail("provider_error");
  }
}
