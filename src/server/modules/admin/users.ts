import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { revokeAllSessions } from "@/server/modules/auth/session";
import { requirePermission } from "@/server/modules/rbac/service";
import { isPlatformScope, platformChain } from "@/server/modules/rbac/scope";

const listInput = z.object({ q: z.string().trim().max(200).default(""), limit: z.coerce.number().int().min(1).max(200).default(100) });

/** Platform user directory: identity, status and memberships. Never password hashes, tokens or MFA secrets. */
export async function listPlatformUsers(ctx: RequestContext, raw: z.input<typeof listInput> = {}) {
  const { q, limit } = listInput.parse(raw);
  await requirePermission(ctx, "platform.users.read", platformChain());
  const users = await db().user.findMany({
    where: q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
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
    },
  });
  const grants = await db().roleAssignment.findMany({
    where: { principalType: "USER", principalId: { in: users.map((u) => u.id) } },
    select: { principalId: true, scopeType: true, role: { select: { key: true } } },
  });
  return users.map(({ _count, ...u }) => ({
    ...u,
    organizations: _count.memberships,
    platformRoles: [...new Set(grants.filter((g) => g.principalId === u.id && isPlatformScope(g.scopeType)).map((g) => g.role.key))],
  }));
}

/** Organizations on the platform with their size. Read-only: tenant data stays behind tenant permissions. */
export async function listPlatformOrganizations(ctx: RequestContext, raw: z.input<typeof listInput> = {}) {
  const { q, limit } = listInput.parse(raw);
  await requirePermission(ctx, "platform.organizations.read", platformChain());
  const orgs = await db().organization.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      createdAt: true,
      _count: { select: { memberships: { where: { status: "ACTIVE" } }, companies: { where: { deletedAt: null } } } },
      subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "INCOMPLETE", "UNPAID", "PAUSED"] } }, select: { status: true }, take: 1 },
    },
  });
  return orgs.map(({ _count, subscriptions, ...o }) => ({ ...o, members: _count.memberships, companies: _count.companies, subscription: subscriptions[0]?.status ?? null }));
}

export const userStatusInput = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]), reason: z.string().trim().min(3).max(500) });

/**
 * Suspend or reactivate a user. Suspension takes effect immediately: sign-in and every session check require ACTIVE,
 * and all sessions are revoked. Platform administrators cannot be suspended here (remove their platform role first),
 * and nobody can change their own status.
 */
export async function setUserStatus(ctx: RequestContext, userId: string, raw: z.input<typeof userStatusInput>) {
  const { status, reason } = userStatusInput.parse(raw);
  if (!z.string().uuid().safeParse(userId).success) throw notFound("User");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    if (userId === ctx.actor.id) throw invalid("You cannot change your own status");
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
    if (!user) throw notFound("User");
    if (user.status === "DELETED") throw conflict("Deleted users cannot be changed");
    if (status === "SUSPENDED") {
      const grants = await tx.roleAssignment.findMany({ where: { principalType: "USER", principalId: userId }, select: { scopeType: true } });
      if (grants.some((g) => isPlatformScope(g.scopeType))) throw conflict("Platform administrators cannot be suspended; remove their platform role first", { reason: "platform_admin" });
    }
    if (user.status === status) return { id: userId, status };
    await tx.user.update({ where: { id: userId }, data: { status } });
    if (status === "SUSPENDED") await revokeAllSessions(tx, userId);
    await writeAudit(tx, ctx, { category: "ADMIN", action: status === "SUSPENDED" ? "user.suspended" : "user.reactivated", resourceType: "user", resourceId: userId, oldValue: { status: user.status }, newValue: { status }, reason });
    return { id: userId, status };
  });
}
