import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { prismaPage, toPage } from "@/server/core/pagination";
import { writeAudit } from "@/server/modules/audit/service";
import { revokeAllSessions } from "@/server/modules/auth/session";
import { assignRole, requirePermission, revokeAssignment, systemRoleId } from "@/server/modules/rbac/service";
import { isPlatformScope, platformChain } from "@/server/modules/rbac/scope";
import { SYSTEM_ROLES } from "@/server/modules/rbac/catalog";
import { costMicros } from "@/server/modules/workforce/pricing";
import { daysAgo, isUuid, reasonSchema, requireConfirmation, utcMonthStart } from "./access";

const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

const listInput = z.object({
  q: z.string().trim().max(200).default(""),
  status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]).optional().catch(undefined),
  mfa: z.enum(["on", "off"]).optional().catch(undefined),
  created: z.enum(["7d", "30d", "90d"]).optional().catch(undefined),
  login: z.enum(["7d", "30d", "never", "inactive30"]).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional().catch(undefined),
});
export type UserFilters = Partial<Record<keyof z.input<typeof listInput>, unknown>>;

/** Platform user directory: identity, status, memberships, last sign-in. Never password hashes, tokens or MFA secrets. */
export async function listPlatformUsers(ctx: RequestContext, raw: UserFilters = {}) {
  const f = listInput.parse(raw);
  await requirePermission(ctx, "platform.users.read", platformChain());
  const where: Prisma.UserWhereInput = {
    ...(f.q ? { OR: [{ email: { contains: f.q, mode: "insensitive" } }, { name: { contains: f.q, mode: "insensitive" } }] } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.mfa ? { mfaEnabled: f.mfa === "on" } : {}),
    ...(f.created ? { createdAt: { gte: daysAgo(PERIOD_DAYS[f.created]) } } : {}),
    ...(f.login === "7d" || f.login === "30d" ? { sessions: { some: { createdAt: { gte: daysAgo(PERIOD_DAYS[f.login]) } } } } : {}),
    ...(f.login === "never" ? { sessions: { none: {} } } : {}),
    ...(f.login === "inactive30" ? { sessions: { none: { createdAt: { gte: daysAgo(30) } } } } : {}),
  };
  const [rows, total] = await Promise.all([
    db().user.findMany({
      where,
      orderBy: { id: "desc" },
      ...prismaPage({ limit: f.limit, cursor: f.cursor }),
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        mfaEnabled: true,
        emailVerifiedAt: true,
        countryCode: true,
        createdAt: true,
        _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
        sessions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      },
    }),
    db().user.count({ where }),
  ]);
  const page = toPage(rows, { limit: f.limit, cursor: f.cursor });
  const grants = await db().roleAssignment.findMany({
    where: { principalType: "USER", principalId: { in: page.data.map((u) => u.id) } },
    select: { principalId: true, scopeType: true, role: { select: { key: true } } },
  });
  return {
    total,
    nextCursor: page.nextCursor,
    data: page.data.map(({ _count, sessions, ...u }) => ({
      ...u,
      organizations: _count.memberships,
      lastLoginAt: sessions[0]?.createdAt ?? null,
      platformRoles: [...new Set(grants.filter((g) => g.principalId === u.id && isPlatformScope(g.scopeType)).map((g) => g.role.key))],
    })),
  };
}

/** Full profile of one user for support and security work. */
export async function getPlatformUser(ctx: RequestContext, userId: string) {
  await requirePermission(ctx, "platform.users.read", platformChain());
  if (!isUuid(userId)) throw notFound("User");
  const user = await db().user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      mfaEnabled: true,
      emailVerifiedAt: true,
      countryCode: true,
      locale: true,
      timezone: true,
      createdAt: true,
      updatedAt: true,
      oauthAccounts: { select: { provider: true, lastLoginAt: true } },
      memberships: { select: { status: true, createdAt: true, organization: { select: { id: true, name: true, slug: true, status: true } } } },
    },
  });
  if (!user) throw notFound("User");
  const orgIds = user.memberships.map((m) => m.organization.id);
  const [grants, sessions, security, subscriptions, tasksMonth, aiRows] = await Promise.all([
    db().roleAssignment.findMany({
      where: { principalType: "USER", principalId: userId },
      select: { id: true, scopeType: true, scopeId: true, organizationId: true, expiresAt: true, createdAt: true, role: { select: { key: true, name: true } } },
    }),
    db().session.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, mfaVerifiedAt: true },
    }),
    db().auditLog.findMany({ where: { category: { in: ["SECURITY", "ADMIN"] }, OR: [{ actorId: userId }, { resourceId: userId }] }, orderBy: { createdAt: "desc" }, take: 30 }),
    db().subscription.findMany({
      where: { organizationId: { in: orgIds }, status: { notIn: ["CANCELED", "INCOMPLETE_EXPIRED"] } },
      select: { organizationId: true, status: true, interval: true, currency: true, currentPeriodEnd: true, plan: { select: { name: true, key: true } } },
    }),
    db().agentTask.count({ where: { createdById: userId, createdAt: { gte: utcMonthStart() } } }),
    db().agentTask.groupBy({ by: ["model"], where: { createdById: userId, startedAt: { gte: utcMonthStart() } }, _sum: { inputTokens: true, outputTokens: true } }),
  ]);
  const ai = aiRows.reduce(
    (acc, r) => {
      const i = r._sum.inputTokens ?? 0;
      const o = r._sum.outputTokens ?? 0;
      return { tokens: acc.tokens + i + o, costMicros: acc.costMicros + costMicros(r.model, i, o) };
    },
    { tokens: 0, costMicros: 0 },
  );
  const now = new Date();
  return {
    ...user,
    lastLoginAt: sessions[0]?.createdAt ?? null,
    activeSessions: sessions.filter((s) => !s.revokedAt && s.expiresAt > now).length,
    sessions,
    security,
    subscriptions,
    usage: { tasksThisMonth: tasksMonth, ...ai },
    platformGrants: grants.filter((g) => isPlatformScope(g.scopeType)),
    memberships: user.memberships.map((m) => ({ ...m, roles: grants.filter((g) => g.organizationId === m.organization.id).map((g) => g.role.key) })),
  };
}

export const userStatusInput = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]), reason: reasonSchema });

async function isPlatformAdminUser(tx: Prisma.TransactionClient, userId: string) {
  const grants = await tx.roleAssignment.findMany({ where: { principalType: "USER", principalId: userId }, select: { scopeType: true } });
  return grants.some((g) => isPlatformScope(g.scopeType));
}

/**
 * Suspend or reactivate a user. Suspension takes effect immediately: sign-in and every session check require ACTIVE,
 * and all sessions are revoked. Platform administrators cannot be suspended here (remove their platform role first),
 * and nobody can change their own status.
 */
export async function setUserStatus(ctx: RequestContext, userId: string, raw: z.input<typeof userStatusInput>) {
  const { status, reason } = userStatusInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    if (userId === ctx.actor.id) throw invalid("You cannot change your own status");
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
    if (!user) throw notFound("User");
    if (user.status === "DELETED") throw conflict("Deleted users cannot be changed");
    if (status === "SUSPENDED" && (await isPlatformAdminUser(tx, userId))) {
      throw conflict("Platform administrators cannot be suspended; remove their platform role first", { reason: "platform_admin" });
    }
    if (user.status === status) return { id: userId, status };
    await tx.user.update({ where: { id: userId }, data: { status } });
    if (status === "SUSPENDED") await revokeAllSessions(tx, userId);
    await writeAudit(tx, ctx, { category: "ADMIN", action: status === "SUSPENDED" ? "user.suspended" : "user.reactivated", resourceType: "user", resourceId: userId, oldValue: { status: user.status }, newValue: { status }, reason });
    return { id: userId, status };
  });
}

/** Sign a user out everywhere (an admin revoking their own sessions keeps the current one). */
export async function revokeUserSessions(ctx: RequestContext, userId: string, raw: { reason?: string }) {
  const reason = reasonSchema.parse(raw.reason);
  if (!isUuid(userId)) throw notFound("User");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    if (!(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw notFound("User");
    const active = await tx.session.count({ where: { userId, revokedAt: null } });
    await revokeAllSessions(tx, userId, userId === ctx.actor.id ? (ctx.sessionId ?? undefined) : undefined);
    await writeAudit(tx, ctx, { category: "SECURITY", action: "user.sessions_revoked", resourceType: "user", resourceId: userId, newValue: { sessions: active }, reason });
    return { revoked: active };
  });
}

export const deleteUserInput = z.object({ reason: reasonSchema, confirm: z.string().max(254) });

/**
 * Safe delete: the account is marked DELETED, its email and name are anonymized, sessions, OAuth links and MFA are
 * removed, memberships suspended. Audit history is kept. Refused while the user is the only owner of an organization
 * that still has other members (ownership must be transferred first), and for platform administrators.
 */
export async function softDeleteUser(ctx: RequestContext, userId: string, raw: z.input<typeof deleteUserInput>) {
  const input = deleteUserInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    if (userId === ctx.actor.id) throw invalid("You cannot delete your own account here");
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, status: true } });
    if (!user) throw notFound("User");
    if (user.status === "DELETED") throw conflict("This user is already deleted");
    requireConfirmation(input.confirm, user.email);
    if (await isPlatformAdminUser(tx, userId)) throw conflict("Remove the user's platform roles first", { reason: "platform_admin" });
    const owned = await tx.roleAssignment.findMany({
      where: { principalType: "USER", principalId: userId, scopeType: "ORGANIZATION", role: { key: "ORGANIZATION_OWNER", organizationId: null } },
      select: { organizationId: true },
    });
    for (const o of owned) {
      if (!o.organizationId) continue;
      const [owners, members] = await Promise.all([
        tx.roleAssignment.count({
          where: { organizationId: o.organizationId, scopeType: "ORGANIZATION", principalType: "USER", principalId: { not: userId }, role: { key: "ORGANIZATION_OWNER", organizationId: null } },
        }),
        tx.membership.count({ where: { organizationId: o.organizationId, status: "ACTIVE", userId: { not: userId } } }),
      ]);
      if (owners === 0 && members > 0) {
        throw conflict("The user is the only owner of an organization with other members; transfer ownership first", { reason: "sole_owner", organizationId: o.organizationId });
      }
    }
    await revokeAllSessions(tx, userId);
    await tx.user.update({ where: { id: userId }, data: { status: "DELETED", email: `deleted+${user.id}@deleted.invalid`, name: "Deleted user", passwordHash: null, mfaEnabled: false } });
    await tx.oAuthAccount.deleteMany({ where: { userId } });
    await tx.mfaFactor.deleteMany({ where: { userId } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.membership.updateMany({ where: { userId }, data: { status: "SUSPENDED" } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "user.deleted", resourceType: "user", resourceId: userId, oldValue: { status: user.status }, newValue: { status: "DELETED", anonymized: true }, reason: input.reason });
    return { id: userId, status: "DELETED" as const };
  });
}

// ───────────── Platform roles ─────────────

export const PLATFORM_ROLE_KEYS = SYSTEM_ROLES.filter((r) => r.assignableAt.includes("PLATFORM")).map((r) => r.key);
export const grantPlatformRoleInput = z.object({ roleKey: z.string().max(64), reason: reasonSchema });

/** Grant a PLATFORM-scoped system role (rbac assignRole: platform.security.manage, MFA, no self-escalation). */
export async function grantPlatformRole(ctx: RequestContext, userId: string, raw: z.input<typeof grantPlatformRoleInput>) {
  const input = grantPlatformRoleInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  if (!PLATFORM_ROLE_KEYS.includes(input.roleKey)) throw invalid("Unknown platform role");
  return transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user) throw notFound("User");
    if (user.status !== "ACTIVE") throw conflict("Only active users can receive platform roles");
    const roleId = await systemRoleId(tx, input.roleKey);
    const r = await assignRole(ctx, null, { principalType: "USER", principalId: userId, roleId, scopeType: "PLATFORM", scopeId: "*" }, tx);
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.role_granted", resourceType: "user", resourceId: userId, newValue: { roleKey: input.roleKey, assignmentId: r.id }, reason: input.reason });
    return r;
  });
}

export async function revokePlatformRole(ctx: RequestContext, userId: string, assignmentId: string, raw: { reason?: string }) {
  const reason = reasonSchema.parse(raw.reason);
  if (!isUuid(userId) || !isUuid(assignmentId)) throw notFound("Role assignment");
  await requirePermission(ctx, "platform.security.manage", platformChain());
  const a = await db().roleAssignment.findUnique({ where: { id: assignmentId }, select: { principalId: true, scopeType: true, role: { select: { key: true } } } });
  if (!a || a.principalId !== userId || !isPlatformScope(a.scopeType)) throw notFound("Role assignment");
  if (a.role.key === "SUPER_ADMIN") {
    const supers = await db().roleAssignment.count({ where: { scopeType: "PLATFORM", role: { key: "SUPER_ADMIN", organizationId: null } } });
    if (supers <= 1) throw conflict("The platform must keep at least one super admin", { reason: "last_super_admin" });
  }
  await revokeAssignment(ctx, null, assignmentId);
  await transaction((tx) => writeAudit(tx, ctx, { category: "SECURITY", action: "platform.role_revoked", resourceType: "user", resourceId: userId, oldValue: { roleKey: a.role.key, assignmentId }, reason }));
  return { ok: true };
}

// ───────────── Organizations (list) ─────────────

const orgListInput = z.object({
  q: z.string().trim().max(200).default(""),
  status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]).optional().catch(undefined),
  subscription: z.enum(["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED", "NONE"]).optional().catch(undefined),
  created: z.enum(["7d", "30d", "90d"]).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional().catch(undefined),
});
export type OrgFilters = Partial<Record<keyof z.input<typeof orgListInput>, unknown>>;

/** Organizations on the platform with size, plan and AI activity. Tenant records stay behind the audited detail view. */
export async function listPlatformOrganizations(ctx: RequestContext, raw: OrgFilters = {}) {
  const f = orgListInput.parse(raw);
  await requirePermission(ctx, "platform.organizations.read", platformChain());
  const live = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;
  const where: Prisma.OrganizationWhereInput = {
    ...(f.q
      ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { slug: { contains: f.q, mode: "insensitive" } }, { companies: { some: { name: { contains: f.q, mode: "insensitive" } } } }] }
      : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.subscription === "NONE" ? { subscriptions: { none: { status: { in: [...live] } } } } : f.subscription ? { subscriptions: { some: { status: f.subscription } } } : {}),
    ...(f.created ? { createdAt: { gte: daysAgo(PERIOD_DAYS[f.created]) } } : {}),
  };
  const [rows, total] = await Promise.all([
    db().organization.findMany({
      where,
      orderBy: { id: "desc" },
      ...prismaPage({ limit: f.limit, cursor: f.cursor }),
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        _count: { select: { memberships: { where: { status: "ACTIVE" } }, companies: { where: { deletedAt: null } } } },
        subscriptions: { where: { status: { notIn: ["CANCELED", "INCOMPLETE_EXPIRED"] } }, orderBy: { createdAt: "desc" }, select: { status: true, plan: { select: { name: true } } }, take: 1 },
      },
    }),
    db().organization.count({ where }),
  ]);
  const page = toPage(rows, { limit: f.limit, cursor: f.cursor });
  const tasks = await db().agentTask.groupBy({ by: ["organizationId"], where: { organizationId: { in: page.data.map((o) => o.id) }, createdAt: { gte: daysAgo(30) } }, _count: { _all: true } });
  return {
    total,
    nextCursor: page.nextCursor,
    data: page.data.map(({ _count, subscriptions, ...o }) => ({
      ...o,
      members: _count.memberships,
      companies: _count.companies,
      subscription: subscriptions[0] ? { status: subscriptions[0].status, plan: subscriptions[0].plan.name } : null,
      aiTasks30d: tasks.find((t) => t.organizationId === o.id)?._count._all ?? 0,
    })),
  };
}
