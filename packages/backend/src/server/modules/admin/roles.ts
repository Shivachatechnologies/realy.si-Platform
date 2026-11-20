import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { env } from "@/server/core/env";
import { AppError, notFound } from "@/server/core/errors";
import { verifyMfa } from "@/server/modules/auth/service";
import { writeAudit } from "@/server/modules/audit/service";
import { SYSTEM_ROLES } from "@/server/modules/rbac/catalog";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { isUuid, reasonSchema, requireAnyPlatform, utcMonthStart } from "./access";
import { PLATFORM_ROLE_KEYS, grantPlatformRole, revokePlatformRole } from "./users";

/**
 * Platform roles & support tools (Admin → Access): who holds which platform role (SUPER_ADMIN, operators, support…),
 * grant / revoke with a reason and an MFA re-check (a fresh authenticator code on every change), and a read-only
 * "view as" summary of what a user can see — no session impersonation, ever.
 */

export async function platformRolesOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.security.read", "platform.security.manage", "platform.users.read"]);
  const assignments = await db().roleAssignment.findMany({
    where: { principalType: "USER", scopeType: { in: ["PLATFORM", "REGION", "COUNTRY"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, principalId: true, scopeType: true, scopeId: true, grantedById: true, expiresAt: true, createdAt: true, role: { select: { key: true, name: true } } },
  });
  const ids = [...new Set(assignments.flatMap((a) => [a.principalId, a.grantedById].filter((x): x is string => !!x)))];
  const users = await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, status: true, mfaEnabled: true } });
  const userOf = (id: string) => users.find((u) => u.id === id);
  return {
    roles: SYSTEM_ROLES.filter((r) => r.assignableAt.some((s) => s === "PLATFORM" || s === "REGION" || s === "COUNTRY")).map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
      grantable: PLATFORM_ROLE_KEYS.includes(r.key),
      holders: assignments
        .filter((a) => a.role.key === r.key)
        .map((a) => ({ assignmentId: a.id, scope: a.scopeType === "PLATFORM" ? "PLATFORM" : `${a.scopeType}:${a.scopeId}`, createdAt: a.createdAt, expiresAt: a.expiresAt, user: userOf(a.principalId) ?? null, grantedBy: a.grantedById ? (userOf(a.grantedById)?.name ?? null) : null, userId: a.principalId })),
    })),
    holders: new Set(assignments.map((a) => a.principalId)).size,
    withoutMfa: users.filter((u) => assignments.some((a) => a.principalId === u.id) && !u.mfaEnabled).length,
  };
}

/**
 * MFA re-check for role changes: a current authenticator (or recovery) code is verified against this session.
 * Development may relax it with REALY_DEV_RELAX_MFA.
 */
async function recheckMfa(ctx: RequestContext, code: string | undefined) {
  if (env().REALY_DEV_RELAX_MFA && !code) return;
  if (!ctx.sessionId) throw new AppError("mfa_required", "Confirm with your authenticator code", { reason: "mfa_recheck" });
  if (!code) throw new AppError("mfa_required", "Enter the current code from your authenticator app", { reason: "mfa_recheck" });
  await verifyMfa(ctx, ctx.sessionId, ctx.actor.id!, code);
}

export const grantRoleInput = z.object({ email: z.string().trim().toLowerCase().email().max(254), roleKey: z.string().max(64), reason: reasonSchema, mfaCode: z.string().trim().max(20).optional() });

export async function grantRoleByEmail(ctx: RequestContext, raw: z.input<typeof grantRoleInput>) {
  const input = grantRoleInput.parse(raw);
  await requirePermission(ctx, "platform.security.manage", platformChain());
  const user = await db().user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (!user) throw notFound("User");
  await recheckMfa(ctx, input.mfaCode);
  return grantPlatformRole(ctx, user.id, { roleKey: input.roleKey, reason: input.reason });
}

export const revokeRoleInput = z.object({ reason: reasonSchema, mfaCode: z.string().trim().max(20).optional() });

export async function revokeRoleAssignment(ctx: RequestContext, assignmentId: string, raw: z.input<typeof revokeRoleInput>) {
  const input = revokeRoleInput.parse(raw);
  if (!isUuid(assignmentId)) throw notFound("Role assignment");
  await requirePermission(ctx, "platform.security.manage", platformChain());
  const a = await db().roleAssignment.findUnique({ where: { id: assignmentId }, select: { principalId: true } });
  if (!a) throw notFound("Role assignment");
  await recheckMfa(ctx, input.mfaCode);
  return revokePlatformRole(ctx, a.principalId, assignmentId, { reason: input.reason });
}

// ───────────── Support: read-only "view as" ─────────────

export const viewAsInput = z.object({ reason: reasonSchema });

/**
 * A read-only summary of what one user sees: memberships, roles per organization, companies, notifications, pending
 * approvals and recent activity. Audited (platform.support.view_as) with the reason; no session is created.
 */
export async function viewAsSummary(ctx: RequestContext, userId: string, raw: z.input<typeof viewAsInput>) {
  const { reason } = viewAsInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  await requireAnyPlatform(ctx, ["platform.support.read", "platform.users.read"]);
  const user = await db().user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, status: true, locale: true, timezone: true, mfaEnabled: true, createdAt: true } });
  if (!user) throw notFound("User");
  const [memberships, grants, unread, notifications, activity, sessions] = await Promise.all([
    db().membership.findMany({ where: { userId }, select: { status: true, createdAt: true, organization: { select: { id: true, name: true, slug: true, status: true } } } }),
    db().roleAssignment.findMany({ where: { principalType: "USER", principalId: userId }, select: { scopeType: true, scopeId: true, organizationId: true, role: { select: { key: true, name: true } } } }),
    db().notification.count({ where: { userId, readAt: null } }),
    db().notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, type: true, payload: true, readAt: true, createdAt: true } }),
    db().auditLog.findMany({ where: { actorId: userId }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, action: true, organizationId: true, createdAt: true } }),
    db().session.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  const orgIds = memberships.map((m) => m.organization.id);
  const [companies, aiMonth] = await Promise.all([
    db().company.findMany({ where: { organizationId: { in: orgIds }, deletedAt: null }, select: { id: true, name: true, organizationId: true, status: true } }),
    db().agentTask.count({ where: { createdById: userId, createdAt: { gte: utcMonthStart() } } }).catch(() => 0),
  ]);
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", action: "platform.support.view_as", resourceType: "user", resourceId: userId, reason }));
  return {
    user,
    organizations: memberships.map((m) => ({
      ...m.organization,
      membership: m.status,
      roles: [...new Set(grants.filter((g) => g.organizationId === m.organization.id).map((g) => g.role.key))],
      companies: companies.filter((c) => c.organizationId === m.organization.id),
    })),
    platformRoles: grants.filter((g) => ["PLATFORM", "REGION", "COUNTRY"].includes(g.scopeType)).map((g) => g.role.key),
    unread,
    notifications,
    activity,
    sessions,
    aiTasksMonth: aiMonth,
  };
}
