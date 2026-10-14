import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/core/db";
import { newRequestId, userContext, type RequestContext } from "@/server/core/context";
import { SESSION_COOKIE, validateSessionToken, type SessionInfo } from "@/server/modules/auth/session";
import type { AppLocale } from "@/i18n/config";

export const ORG_COOKIE = "realy_org";
export const COMPANY_COOKIE = "realy_company";

/** Data Access Layer: the current session, read once per request. Never trust client-provided identity. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const jar = await cookies();
  return validateSessionToken(jar.get(SESSION_COOKIE)?.value);
});

export interface Viewer {
  session: SessionInfo;
  user: { id: string; email: string; name: string; locale: string; timezone: string; countryCode: string | null; mfaEnabled: boolean };
  ctx: RequestContext;
}

/** Signed-in, MFA-complete viewer, or redirect to sign-in / MFA. */
export const requireViewer = cache(async (locale: AppLocale): Promise<Viewer> => {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.mfaPending) redirect(`/${locale}/mfa`);
  const user = await db().user.findUniqueOrThrow({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, locale: true, timezone: true, countryCode: true, mfaEnabled: true },
  });
  const h = await headers();
  const ctx = userContext(user.id, {
    requestId: newRequestId(h.get("x-request-id")),
    sessionId: session.id,
    mfaVerifiedAt: session.mfaVerifiedAt,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });
  return { session, user, ctx };
});

/** The viewer's active organization (cookie selection validated against membership) and its companies. */
export const getWorkspaceContext = cache(async (userId: string) => {
  const jar = await cookies();
  const orgs = await db().organization.findMany({
    where: { memberships: { some: { userId, status: "ACTIVE" } }, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true },
  });
  const wanted = jar.get(ORG_COOKIE)?.value;
  const org = orgs.find((o) => o.id === wanted) ?? orgs[0] ?? null;
  return { orgs, org, preferredCompanyId: jar.get(COMPANY_COOKIE)?.value ?? null };
});

/** One stable "now" per request, so every component in a render agrees on the current instant. */
export const requestTime = cache((): number => Date.now());
