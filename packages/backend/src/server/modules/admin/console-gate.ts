import { userContext } from "@/server/core/context";
import { isPlatformAdmin } from "@/server/core/platform-controls";
import { validateSessionToken, type SessionInfo } from "@/server/modules/auth/session";
import { mfaSatisfied } from "@/server/modules/rbac/service";

export type ConsoleDenial = "unauthenticated" | "mfa_pending" | "forbidden" | "mfa_required";
export type ConsoleAccess = { ok: true; session: SessionInfo } | { ok: false; reason: ConsoleDenial };

/**
 * Server-side gate for EVERY admin-app request (pages and API), run by apps/admin/src/proxy.ts before routing:
 *   1. a live admin-app session (its own cookie, @realy/auth-core),
 *   2. two-factor verification completed for that session,
 *   3. a platform-scoped role (PLATFORM / REGION / COUNTRY grant, the same check maintenance mode uses),
 *   4. a recent MFA verification (rbac MFA_FRESHNESS_MS; REALY_DEV_RELAX_MFA relaxes it in development only).
 * Route handlers still authorize each action with requirePlatform(ctx, permission) — this gate is the perimeter.
 */
export async function verifyConsoleAccess(token: string | undefined): Promise<ConsoleAccess> {
  const session = await validateSessionToken(token);
  if (!session) return { ok: false, reason: "unauthenticated" };
  if (session.mfaPending) return { ok: false, reason: "mfa_pending" };
  if (!(await isPlatformAdmin(session.userId))) return { ok: false, reason: "forbidden" };
  if (!mfaSatisfied(userContext(session.userId, { sessionId: session.id, mfaVerifiedAt: session.mfaVerifiedAt }))) return { ok: false, reason: "mfa_required" };
  return { ok: true, session };
}
