import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { prismaPage, toPage } from "@/server/core/pagination";
import { writeAudit } from "@/server/modules/audit/service";
import { revokeAllSessions } from "@/server/modules/auth/session";
import { assignRole, requirePermission, revokeAssignment } from "@/server/modules/rbac/service";
import { isPlatformScope, platformChain } from "@/server/modules/rbac/scope";
import { SYSTEM_ROLES } from "@/server/modules/rbac/catalog";
import { costMicros } from "@/server/modules/workforce/pricing";
import { daysAgo, isUuid, reasonSchema, requireConfirmation, utcMonthStart } from "./access";

const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

export const USER_STATUSES = ["ACTIVE", "SUSPENDED", "PENDING_DELETION", "DELETED"] as const;
export const USER_SORTS = ["newest", "oldest", "name", "email"] as const;

const listInput = z.object({
  q: z.string().trim().max(200).default(""),
  status: z.enum(USER_STATUSES).optional().catch(undefined),
  mfa: z.enum(["on", "off"]).optional().catch(undefined),
  verified: z.enum(["yes", "no"]).optional().catch(undefined),
  method: z.enum(["password", "oauth"]).optional().catch(undefined),
  role: z.enum(["admin", "none"]).optional().catch(undefined),
  org: z.string().uuid().optional().catch(undefined),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .catch(undefined),
  created: z.enum(["7d", "30d", "90d"]).optional().catch(undefined),
  login: z.enum(["7d", "30d", "never", "inactive30"]).optional().catch(undefined),
  sort: z.enum(USER_SORTS).default("newest").catch("newest"),
  limit: z.coerce.number().int().min(1).max(200).default(50).catch(50),
  cursor: z.string().uuid().optional().catch(undefined),
});
export type UserFilters = Partial<Record<keyof z.input<typeof listInput>, unknown>>;

const SORT_ORDER: Record<(typeof USER_SORTS)[number], Prisma.UserOrderByWithRelationInput[]> = {
  newest: [{ id: "desc" }],
  oldest: [{ id: "asc" }],
  name: [{ name: "asc" }, { id: "asc" }],
  email: [{ email: "asc" }, { id: "asc" }],
};

const PLATFORM_SCOPES = ["PLATFORM", "REGION", "COUNTRY"] as const;

async function userWhere(f: z.infer<typeof listInput>): Promise<Prisma.UserWhereInput> {
  const and: Prisma.UserWhereInput[] = [];
  if (f.q) and.push(isUuid(f.q) ? { id: f.q } : { OR: [{ email: { contains: f.q, mode: "insensitive" } }, { name: { contains: f.q, mode: "insensitive" } }] });
  if (f.status) and.push({ status: f.status });
  if (f.mfa) and.push({ mfaEnabled: f.mfa === "on" });
  if (f.verified) and.push({ emailVerifiedAt: f.verified === "yes" ? { not: null } : null });
  if (f.method === "oauth") and.push({ oauthAccounts: { some: {} } });
  if (f.method === "password") and.push({ passwordHash: { not: null } });
  if (f.org) and.push({ memberships: { some: { organizationId: f.org } } });
  if (f.country) and.push({ countryCode: f.country });
  if (f.created) and.push({ createdAt: { gte: daysAgo(PERIOD_DAYS[f.created]) } });
  if (f.login === "7d" || f.login === "30d") and.push({ sessions: { some: { createdAt: { gte: daysAgo(PERIOD_DAYS[f.login]) } } } });
  if (f.login === "never") and.push({ sessions: { none: {} } });
  if (f.login === "inactive30") and.push({ sessions: { none: { createdAt: { gte: daysAgo(30) } } } });
  if (f.role) {
    // Platform admins are few: resolve their ids once (bounded) instead of a correlated subquery per row.
    const admins = await db().roleAssignment.findMany({ where: { principalType: "USER", scopeType: { in: [...PLATFORM_SCOPES] } }, select: { principalId: true }, distinct: ["principalId"], take: 5000 });
    const ids = admins.map((a) => a.principalId);
    and.push(f.role === "admin" ? { id: { in: ids } } : { id: { notIn: ids } });
  }
  return and.length ? { AND: and } : {};
}

/** Platform user directory: identity, status, memberships, last sign-in. Never password hashes, tokens or MFA secrets. */
export async function listPlatformUsers(ctx: RequestContext, raw: UserFilters = {}) {
  const f = listInput.parse(raw);
  await requirePermission(ctx, "platform.users.read", platformChain());
  const where = await userWhere(f);
  const [rows, total] = await Promise.all([
    db().user.findMany({
      where,
      orderBy: SORT_ORDER[f.sort],
      ...prismaPage({ limit: f.limit, cursor: f.cursor }),
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        mfaEnabled: true,
        emailVerifiedAt: true,
        countryCode: true,
        locale: true,
        createdAt: true,
        deletionScheduledFor: true,
        restrictions: true,
        passwordHash: true,
        oauthAccounts: { select: { provider: true } },
        _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
        sessions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, lastSeenAt: true } },
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
    limit: f.limit,
    sort: f.sort,
    nextCursor: page.nextCursor,
    data: page.data.map(({ _count, sessions, passwordHash, oauthAccounts, restrictions, ...u }) => ({
      ...u,
      hasPassword: !!passwordHash,
      loginMethods: [...(passwordHash ? ["password"] : []), ...oauthAccounts.map((o) => o.provider)],
      restrictions: parseRestrictions(restrictions),
      organizations: _count.memberships,
      lastLoginAt: sessions[0]?.createdAt ?? null,
      lastSeenAt: sessions[0]?.lastSeenAt ?? null,
      platformRoles: [...new Set(grants.filter((g) => g.principalId === u.id && isPlatformScope(g.scopeType)).map((g) => g.role.key))],
    })),
  };
}

/** CSV export of the filtered directory (platform.data.export + platform.users.read; audited; at most 10,000 rows). */
export async function exportPlatformUsersCsv(ctx: RequestContext, raw: UserFilters & { reason?: unknown }) {
  const reason = reasonSchema.parse(raw.reason);
  const f = listInput.parse({ ...raw, cursor: undefined });
  await requirePermission(ctx, "platform.users.read", platformChain());
  await requirePermission(ctx, "platform.data.export", platformChain());
  const rows = await db().user.findMany({
    where: await userWhere(f),
    orderBy: SORT_ORDER[f.sort],
    take: 10_000,
    select: { id: true, email: true, name: true, status: true, mfaEnabled: true, emailVerifiedAt: true, countryCode: true, locale: true, createdAt: true, _count: { select: { memberships: { where: { status: "ACTIVE" } } } } },
  });
  await transaction((tx) => writeAudit(tx, ctx, { category: "SECURITY", action: "platform.users.exported", resourceType: "user", newValue: { rows: rows.length, filters: { ...f, cursor: undefined } }, reason }));
  const cell = (v: unknown) => {
    const t = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    // Neutralize spreadsheet formulas and quote every cell.
    return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const head = ["id", "email", "name", "status", "mfa", "email_verified_at", "country", "locale", "organizations", "created_at"];
  const lines = rows.map((u) => [u.id, u.email, u.name, u.status, u.mfaEnabled, u.emailVerifiedAt, u.countryCode, u.locale, u._count.memberships, u.createdAt].map(cell).join(","));
  return { csv: [head.join(","), ...lines].join("\n") + "\n", rows: rows.length };
}

// ───────────── Restrictions ─────────────

/** Platform-set restrictions of one account, enforced in rbac (service.ts restrictionReason) on every write check. */
export const USER_RESTRICTIONS = ["readOnly", "aiDisabled"] as const;
export type UserRestrictions = Record<(typeof USER_RESTRICTIONS)[number], boolean>;
export function parseRestrictions(v: unknown): UserRestrictions {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { readOnly: o.readOnly === true, aiDisabled: o.aiDisabled === true };
}

export const restrictionsInput = z.object({ readOnly: z.boolean(), aiDisabled: z.boolean(), reason: reasonSchema });

export async function setUserRestrictions(ctx: RequestContext, userId: string, raw: z.input<typeof restrictionsInput>) {
  const { reason, ...next } = restrictionsInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    if (userId === ctx.actor.id) throw invalid("You cannot restrict your own account");
    const u = await tx.user.findUnique({ where: { id: userId }, select: { restrictions: true, status: true } });
    if (!u) throw notFound("User");
    if (u.status === "DELETED") throw conflict("Deleted users cannot be changed");
    if (await isPlatformAdminUser(tx, userId)) throw conflict("Platform administrators cannot be restricted; remove their platform role first", { reason: "platform_admin" });
    const before = parseRestrictions(u.restrictions);
    await tx.user.update({ where: { id: userId }, data: { restrictions: next } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.user.restrictions_changed", resourceType: "user", resourceId: userId, oldValue: before, newValue: next, reason });
    return { id: userId, restrictions: next };
  });
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
      deletionRequestedAt: true,
      deletionScheduledFor: true,
      restrictions: true,
      passwordHash: true,
      oauthAccounts: { select: { provider: true, providerEmail: true, createdAt: true, lastLoginAt: true } },
      memberships: { select: { status: true, createdAt: true, organization: { select: { id: true, name: true, slug: true, status: true } } } },
    },
  });
  if (!user) throw notFound("User");
  const orgIds = user.memberships.map((m) => m.organization.id);
  const [grants, sessions, security, subscriptions, tasksMonth, aiRows] = await Promise.all([
    db().roleAssignment.findMany({
      where: { principalType: "USER", principalId: userId },
      select: { id: true, scopeType: true, scopeId: true, organizationId: true, expiresAt: true, createdAt: true, grantedById: true, role: { select: { id: true, key: true, name: true, isSystem: true } } },
    }),
    db().session.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, mfaVerifiedAt: true, mfaPending: true, impersonationId: true, impersonatorId: true },
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
  const { passwordHash, restrictions, ...rest } = user;
  return {
    ...rest,
    hasPassword: !!passwordHash,
    restrictions: parseRestrictions(restrictions),
    lastLoginAt: sessions[0]?.createdAt ?? null,
    activeSessions: sessions.filter((s) => !s.revokedAt && s.expiresAt > now).length,
    sessions,
    security,
    subscriptions,
    usage: { tasksThisMonth: tasksMonth, ...ai },
    platformGrants: grants.filter((g) => isPlatformScope(g.scopeType)).map((g) => ({ ...g, expired: !!g.expiresAt && g.expiresAt <= now })),
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
 * and nobody can change their own status. Accounts pending deletion are restored with restoreUser instead.
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
    if (user.status === "PENDING_DELETION") throw conflict("This account is pending deletion; restore it first", { reason: "pending_deletion" });
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

/** Force logout: sign a user out everywhere (an admin revoking their own sessions keeps the current one). */
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

/** Revoke one session of a user (scoped: the session must belong to that user). */
export async function revokeUserSession(ctx: RequestContext, userId: string, sessionId: string, raw: { reason?: string }) {
  const reason = reasonSchema.parse(raw.reason);
  if (!isUuid(userId) || !isUuid(sessionId)) throw notFound("Session");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    const s = await tx.session.findUnique({ where: { id: sessionId }, select: { userId: true, revokedAt: true, ip: true, impersonationId: true } });
    if (!s || s.userId !== userId) throw notFound("Session");
    if (sessionId === ctx.sessionId) throw invalid("Use sign out to end your current session");
    if (s.revokedAt) return { revoked: 0 };
    await tx.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    if (s.impersonationId) await tx.adminImpersonation.updateMany({ where: { id: s.impersonationId, endedAt: null }, data: { endedAt: new Date(), endedBy: "revoked" } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "user.session_revoked", resourceType: "user", resourceId: userId, newValue: { sessionId, ip: s.ip }, reason });
    return { revoked: 1 };
  });
}

export const verifyEmailInput = z.object({ reason: reasonSchema });

/** Mark the user's current email as verified (support confirmed ownership out of band). */
export async function adminVerifyEmail(ctx: RequestContext, userId: string, raw: z.input<typeof verifyEmailInput>) {
  const { reason } = verifyEmailInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    const u = await tx.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, status: true } });
    if (!u) throw notFound("User");
    if (u.status === "DELETED") throw conflict("Deleted users cannot be changed");
    if (u.emailVerifiedAt) return { id: userId, emailVerifiedAt: u.emailVerifiedAt };
    const at = new Date();
    await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: at } });
    await tx.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: at } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.user.email_verified", resourceType: "user", resourceId: userId, newValue: { email: u.email }, reason });
    return { id: userId, emailVerifiedAt: at };
  });
}

// ───────────── Deletion with a grace period ─────────────

export const DELETION_GRACE_DAYS = { default: 30, min: 1, max: 90 } as const;
export const deleteUserInput = z.object({
  reason: reasonSchema,
  confirm: z.string().max(254),
  graceDays: z.coerce.number().int().min(DELETION_GRACE_DAYS.min).max(DELETION_GRACE_DAYS.max).default(DELETION_GRACE_DAYS.default),
});

async function assertDeletable(tx: Prisma.TransactionClient, userId: string) {
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
}

/**
 * Delete with a grace period: the account becomes PENDING_DELETION (no sign-in, all sessions revoked) and is purged —
 * anonymized — after `graceDays` by the people jobs (jobs-people.ts), unless restored first. Refused for platform
 * administrators, for one's own account, and while the user is the only owner of an organization with other members.
 */
export async function requestUserDeletion(ctx: RequestContext, userId: string, raw: z.input<typeof deleteUserInput>) {
  const input = deleteUserInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    if (userId === ctx.actor.id) throw invalid("You cannot delete your own account here");
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, status: true } });
    if (!user) throw notFound("User");
    if (user.status === "DELETED") throw conflict("This user is already deleted");
    if (user.status === "PENDING_DELETION") throw conflict("Deletion is already scheduled", { reason: "pending_deletion" });
    requireConfirmation(input.confirm, user.email);
    await assertDeletable(tx, userId);
    const now = new Date();
    const scheduledFor = new Date(now.getTime() + input.graceDays * 86_400_000);
    await revokeAllSessions(tx, userId);
    await tx.user.update({ where: { id: userId }, data: { status: "PENDING_DELETION", deletionRequestedAt: now, deletionScheduledFor: scheduledFor } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "user.deletion_requested", resourceType: "user", resourceId: userId, oldValue: { status: user.status }, newValue: { status: "PENDING_DELETION", scheduledFor, graceDays: input.graceDays, previousStatus: user.status }, reason: input.reason });
    return { id: userId, status: "PENDING_DELETION" as const, deletionScheduledFor: scheduledFor };
  });
}

export const restoreUserInput = z.object({ reason: reasonSchema });

/** Cancel a scheduled deletion: the account returns to ACTIVE (the user signs in again; sessions stay revoked). */
export async function restoreUser(ctx: RequestContext, userId: string, raw: z.input<typeof restoreUserInput>) {
  const { reason } = restoreUserInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true, deletionScheduledFor: true } });
    if (!user) throw notFound("User");
    if (user.status !== "PENDING_DELETION") throw conflict("Only accounts pending deletion can be restored", { reason: "not_pending_deletion" });
    await tx.user.update({ where: { id: userId }, data: { status: "ACTIVE", deletionRequestedAt: null, deletionScheduledFor: null } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "user.deletion_canceled", resourceType: "user", resourceId: userId, oldValue: { status: "PENDING_DELETION", scheduledFor: user.deletionScheduledFor }, newValue: { status: "ACTIVE" }, reason });
    return { id: userId, status: "ACTIVE" as const };
  });
}

/**
 * The irreversible part: email and name anonymized, password, OAuth links and MFA removed, sessions revoked,
 * memberships suspended. Audit history is kept.
 */
async function anonymize(tx: Prisma.TransactionClient, userId: string) {
  await revokeAllSessions(tx, userId);
  await tx.user.update({ where: { id: userId }, data: { status: "DELETED", email: `deleted+${userId}@deleted.invalid`, name: "Deleted user", passwordHash: null, mfaEnabled: false, deletionScheduledFor: null, restrictions: {} } });
  await tx.oAuthAccount.deleteMany({ where: { userId } });
  await tx.mfaFactor.deleteMany({ where: { userId } });
  await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
  await tx.membership.updateMany({ where: { userId }, data: { status: "SUSPENDED" } });
}

export const purgeUserInput = z.object({ reason: reasonSchema, confirm: z.string().max(254) });

/** Purge now (skip the rest of the grace period) — only for accounts already pending deletion; typed confirmation. */
export async function purgeUserNow(ctx: RequestContext, userId: string, raw: z.input<typeof purgeUserInput>) {
  const input = purgeUserInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true, status: true } });
    if (!user) throw notFound("User");
    if (user.status !== "PENDING_DELETION") throw conflict("Schedule the deletion first", { reason: "not_pending_deletion" });
    requireConfirmation(input.confirm, user.email);
    await assertDeletable(tx, userId);
    await anonymize(tx, userId);
    await writeAudit(tx, ctx, { category: "SECURITY", action: "user.deleted", resourceType: "user", resourceId: userId, oldValue: { status: "PENDING_DELETION" }, newValue: { status: "DELETED", anonymized: true, early: true }, reason: input.reason });
    return { id: userId, status: "DELETED" as const };
  });
}

/**
 * Purge accounts whose grace period ended (people jobs, every 30 min; bounded batch). An account whose purge is no
 * longer safe (it became the sole owner of an organization with members, or got a platform role) stays pending and is
 * listed on its page; it is never purged silently.
 */
export async function purgeDueDeletions(now = new Date(), batch = 50): Promise<number> {
  const due = await db().user.findMany({ where: { status: "PENDING_DELETION", deletionScheduledFor: { lte: now } }, orderBy: { deletionScheduledFor: "asc" }, take: batch, select: { id: true } });
  let purged = 0;
  const sys = systemContext();
  for (const u of due) {
    const ok = await transaction(async (tx) => {
      const cur = await tx.user.findUnique({ where: { id: u.id }, select: { status: true, deletionScheduledFor: true } });
      if (cur?.status !== "PENDING_DELETION" || !cur.deletionScheduledFor || cur.deletionScheduledFor > now) return false;
      try {
        await assertDeletable(tx, u.id);
      } catch {
        return false;
      }
      await anonymize(tx, u.id);
      await writeAudit(tx, sys, { category: "SECURITY", action: "user.deleted", resourceType: "user", resourceId: u.id, oldValue: { status: "PENDING_DELETION" }, newValue: { status: "DELETED", anonymized: true, graceEnded: true } });
      return true;
    });
    if (ok) purged++;
  }
  return purged;
}

/** Why a pending deletion cannot be purged right now (null = it can). Shown on the user page. */
export async function deletionBlocker(userId: string): Promise<{ reason: string; organizationId?: string } | null> {
  try {
    await transaction((tx) => assertDeletable(tx, userId));
    return null;
  } catch (e) {
    const d = (e as { details?: { reason?: string; organizationId?: string } }).details;
    return { reason: d?.reason ?? "unknown", organizationId: d?.organizationId };
  }
}

// ───────────── Platform roles ─────────────

/** Built-in platform-assignable roles (code-defined). Custom platform roles live in `roles` (organizationId null, isSystem false). */
export const PLATFORM_ROLE_KEYS = SYSTEM_ROLES.filter((r) => r.assignableAt.includes("PLATFORM")).map((r) => r.key);
/** Longest temporary platform grant (break-glass has its own, shorter cap in roles.ts). */
export const MAX_GRANT_DAYS = 90;
export const grantPlatformRoleInput = z.object({
  roleKey: z.string().max(64),
  reason: reasonSchema,
  expiresAt: z.coerce.date().optional(),
});

/** Grantable platform role keys: built-in platform roles plus custom platform roles. */
export async function grantablePlatformRoles() {
  const custom = await db().role.findMany({ where: { organizationId: null, isSystem: false, assignableAt: { has: "PLATFORM" } }, orderBy: { name: "asc" }, select: { key: true, name: true } });
  return [...SYSTEM_ROLES.filter((r) => r.assignableAt.includes("PLATFORM")).map((r) => ({ key: r.key, name: r.name, custom: false })), ...custom.map((r) => ({ ...r, custom: true }))];
}

/** Grant a PLATFORM-scoped role, optionally temporary (rbac assignRole: platform.security.manage, MFA, no self-escalation). */
export async function grantPlatformRole(ctx: RequestContext, userId: string, raw: z.input<typeof grantPlatformRoleInput>) {
  const input = grantPlatformRoleInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  if (input.expiresAt) {
    const ms = input.expiresAt.getTime() - Date.now();
    if (ms < 5 * 60_000) throw invalid("A temporary grant must last at least 5 minutes", { field: "expiresAt" });
    if (ms > MAX_GRANT_DAYS * 86_400_000) throw invalid(`A temporary grant lasts at most ${MAX_GRANT_DAYS} days`, { field: "expiresAt" });
  }
  return transaction(async (tx) => {
    const role = await tx.role.findFirst({ where: { organizationId: null, key: input.roleKey, assignableAt: { has: "PLATFORM" } }, select: { id: true, isSystem: true } });
    if (!role || (role.isSystem && !PLATFORM_ROLE_KEYS.includes(input.roleKey))) throw invalid("Unknown platform role");
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user) throw notFound("User");
    if (user.status !== "ACTIVE") throw conflict("Only active users can receive platform roles");
    const r = await assignRole(ctx, null, { principalType: "USER", principalId: userId, roleId: role.id, scopeType: "PLATFORM", scopeId: "*", expiresAt: input.expiresAt }, tx);
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.role_granted", resourceType: "user", resourceId: userId, newValue: { roleKey: input.roleKey, assignmentId: r.id, expiresAt: input.expiresAt ?? null }, reason: input.reason });
    return r;
  });
}

export async function revokePlatformRole(ctx: RequestContext, userId: string, assignmentId: string, raw: { reason?: string }) {
  const reason = reasonSchema.parse(raw.reason);
  if (!isUuid(userId) || !isUuid(assignmentId)) throw notFound("Role assignment");
  await requirePermission(ctx, "platform.security.manage", platformChain());
  const a = await db().roleAssignment.findUnique({ where: { id: assignmentId }, select: { principalId: true, scopeType: true, expiresAt: true, role: { select: { key: true } } } });
  if (!a || a.principalId !== userId || !isPlatformScope(a.scopeType)) throw notFound("Role assignment");
  if (a.role.key === "SUPER_ADMIN") {
    const now = new Date();
    const supers = await db().roleAssignment.count({ where: { scopeType: "PLATFORM", role: { key: "SUPER_ADMIN", organizationId: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } });
    const permanent = !a.expiresAt || a.expiresAt > now;
    if (permanent && supers <= 1) throw conflict("The platform must keep at least one super admin", { reason: "last_super_admin" });
  }
  await revokeAssignment(ctx, null, assignmentId);
  await transaction((tx) => writeAudit(tx, ctx, { category: "SECURITY", action: "platform.role_revoked", resourceType: "user", resourceId: userId, oldValue: { roleKey: a.role.key, assignmentId }, reason }));
  return { ok: true };
}

/**
 * Remove platform grants whose temporary period ended (people jobs). They already grant nothing (rbac loadGrants
 * filters expiresAt); deleting them keeps holder lists honest and leaves one audit record per expiry.
 */
export async function sweepExpiredPlatformGrants(now = new Date(), batch = 200): Promise<number> {
  const rows = await db().roleAssignment.findMany({
    where: { scopeType: { in: [...PLATFORM_SCOPES] }, expiresAt: { lte: now } },
    take: batch,
    select: { id: true, principalType: true, principalId: true, scopeType: true, scopeId: true, expiresAt: true, role: { select: { key: true } } },
  });
  if (!rows.length) return 0;
  const sys = systemContext();
  await transaction(async (tx) => {
    await tx.roleAssignment.deleteMany({ where: { id: { in: rows.map((r) => r.id) }, expiresAt: { lte: now } } });
    for (const r of rows) {
      await writeAudit(tx, sys, { category: "SECURITY", action: "platform.role_expired", resourceType: "user", resourceId: r.principalId, oldValue: { roleKey: r.role.key, assignmentId: r.id, scope: `${r.scopeType}:${r.scopeId}`, expiresAt: r.expiresAt } });
    }
  });
  return rows.length;
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
