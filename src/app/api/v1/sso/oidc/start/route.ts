import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/server/core/env";
import { clientIp } from "@/server/core/http";
import { consume } from "@/server/core/rate-limit";
import { LIMITS } from "@/server/core/limits";
import { beginSso, SSO_COOKIE, SsoError } from "@/server/modules/enterprise/sso";
import { closestLocale } from "@/i18n/config";

/** Browser navigation: /api/v1/sso/oidc/start?email=…&locale=… → the organization's identity provider. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const locale = closestLocale(q.get("locale"));
  const back = (code: string) => NextResponse.redirect(new URL(`/${locale}/sso?error=${code}`, env().APP_URL));
  const email = z.string().trim().email().max(254).safeParse(q.get("email"));
  if (!email.success) return back("invalid_email");
  const limit = await consume(LIMITS.oauth[0], clientIp(req) ?? "no-ip");
  if (!limit.allowed) return back("rate_limited");
  try {
    const { url, cookie, maxAgeSeconds } = await beginSso(email.data, locale);
    const res = NextResponse.redirect(url);
    res.cookies.set(SSO_COOKIE, cookie, {
      httpOnly: true,
      secure: env().NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/v1/sso",
      maxAge: maxAgeSeconds,
    });
    return res;
  } catch (err) {
    return back(err instanceof SsoError ? err.code : "provider_error");
  }
}
