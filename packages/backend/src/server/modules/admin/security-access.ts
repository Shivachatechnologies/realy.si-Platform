import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { isUuid, reasonSchema, requireAnyPlatform } from "./access";

/**
 * Security history and session management for /security/access (stream F; split out of ops.ts in Step 0):
 * login history (sessions + auth audit), permission-change history, and revoking any one session.
 */

// ───────────── Security history & sessions ─────────────

const PERMISSION_ACTIONS = ["role.assigned", "role.revoked", "platform.role_granted", "platform.role_revoked", "platform.organization.member_added", "platform.organization.member_role_changed", "platform.organization.member_removed", "role.created", "role.updated", "role.deleted"];

export async function securityHistory(ctx: RequestContext, raw: { user?: string } = {}) {
  await requireAnyPlatform(ctx, ["platform.security.read", "platform.security.manage", "platform.audit.read"]);
  const userId = raw.user && isUuid(raw.user) ? raw.user : undefined;
  const [sessions, authEvents, permissionChanges, activeCount] = await Promise.all([
    db().session.findMany({ where: { ...(userId ? { userId } : {}) }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, userId: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, mfaVerifiedAt: true, user: { select: { name: true, email: true } } } }),
    db().auditLog.findMany({ where: { action: { startsWith: "auth." }, ...(userId ? { actorId: userId } : {}) }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, action: true, actorId: true, newValue: true, createdAt: true } }),
    db().auditLog.findMany({ where: { action: { in: PERMISSION_ACTIONS }, ...(userId ? { OR: [{ actorId: userId }, { resourceId: userId }] } : {}) }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, action: true, actorId: true, organizationId: true, resourceId: true, newValue: true, oldValue: true, reason: true, createdAt: true } }),
    db().session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  const adminIds = new Set((await db().roleAssignment.findMany({ where: { principalType: "USER", scopeType: { in: ["PLATFORM", "REGION", "COUNTRY"] } }, select: { principalId: true } })).map((a) => a.principalId));
  const ids = [...new Set([...authEvents.map((a) => a.actorId), ...permissionChanges.flatMap((p) => [p.actorId, p.resourceId])].filter((x): x is string => !!x && isUuid(x)))];
  const people = await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const name = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? id.slice(0, 8)) : "system");
  const now = new Date();
  return {
    activeCount,
    sessions: sessions.map((s) => ({ ...s, admin: adminIds.has(s.userId), state: s.revokedAt ? "revoked" : s.expiresAt <= now ? "expired" : "active" })),
    authEvents: authEvents.map((a) => ({ ...a, who: name(a.actorId) })),
    permissionChanges: permissionChanges.map((p) => ({ ...p, who: name(p.actorId), target: name(p.resourceId) })),
  };
}

export const revokeSessionInput = z.object({ reason: reasonSchema });

/** Revoke one session (any user). Revoking your own current session is refused (sign out instead). */
export async function revokeSession(ctx: RequestContext, sessionId: string, raw: z.input<typeof revokeSessionInput>) {
  const { reason } = revokeSessionInput.parse(raw);
  if (!isUuid(sessionId)) throw notFound("Session");
  if (sessionId === ctx.sessionId) throw conflict("This is your current session — sign out instead");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.security.manage", platformChain(), tx);
    const s = await tx.session.findUnique({ where: { id: sessionId }, select: { userId: true, revokedAt: true } });
    if (!s) throw notFound("Session");
    if (s.revokedAt) throw conflict("The session is already revoked");
    await tx.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.session_revoked", resourceType: "session", resourceId: sessionId, newValue: { userId: s.userId }, reason });
    return { ok: true };
  });
}
