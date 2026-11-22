import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { MFA_GATED, PERMISSIONS, PLATFORM_ONLY, SYSTEM_ROLES } from "@/server/modules/rbac/catalog";
import { can, invalidateGrants, loadGrants, requirePermission } from "@/server/modules/rbac/service";
import { isPlatformScope, platformChain } from "@/server/modules/rbac/scope";
import { isUuid, mfaCodeSchema, reasonSchema, recheckMfa, requireAnyPlatform, requireConfirmation, utcMonthStart } from "./access";
import { notifyAdmins } from "./notifications";
import { MAX_GRANT_DAYS, PLATFORM_ROLE_KEYS, grantPlatformRole, revokePlatformRole } from "./users";

/**
 * Platform roles & support tools (Admin → Access): who holds which platform role (SUPER_ADMIN, operators, support…),
 * grant / revoke with a reason and an MFA re-check (a fresh authenticator code on every change), and a read-only
 * "view as" summary of what a user can see — no session impersonation, ever.
 */

export async function platformRolesOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.security.read", "platform.security.manage", "platform.users.read", "platform.roles.manage"]);
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
    custom: (await customPlatformRoles()).map((r) => ({
      ...r,
      holders: assignments
        .filter((a) => a.role.key === r.key)
        .map((a) => ({ assignmentId: a.id, scope: "PLATFORM", createdAt: a.createdAt, expiresAt: a.expiresAt, user: userOf(a.principalId) ?? null, grantedBy: a.grantedById ? (userOf(a.grantedById)?.name ?? null) : null, userId: a.principalId })),
    })),
    temporary: assignments.filter((a) => a.expiresAt).length,
    holders: new Set(assignments.map((a) => a.principalId)).size,
    withoutMfa: users.filter((u) => assignments.some((a) => a.principalId === u.id) && !u.mfaEnabled).length,
  };
}

export const grantRoleInput = z.object({ email: z.string().trim().toLowerCase().email().max(254), roleKey: z.string().max(64), reason: reasonSchema, mfaCode: mfaCodeSchema, expiresAt: z.coerce.date().optional() });

export async function grantRoleByEmail(ctx: RequestContext, raw: z.input<typeof grantRoleInput>) {
  const input = grantRoleInput.parse(raw);
  await requirePermission(ctx, "platform.security.manage", platformChain());
  const user = await db().user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (!user) throw notFound("User");
  await recheckMfa(ctx, input.mfaCode);
  return grantPlatformRole(ctx, user.id, { roleKey: input.roleKey, reason: input.reason, expiresAt: input.expiresAt });
}

export const grantToUserInput = z.object({ roleKey: z.string().max(64), reason: reasonSchema, mfaCode: mfaCodeSchema, expiresAt: z.coerce.date().optional() });

/** Grant a platform role from the user page (same MFA re-check as the roles page; optional expiry = temporary grant). */
export async function grantRoleToUser(ctx: RequestContext, userId: string, raw: z.input<typeof grantToUserInput>) {
  const input = grantToUserInput.parse(raw);
  await requirePermission(ctx, "platform.security.manage", platformChain());
  await recheckMfa(ctx, input.mfaCode);
  return grantPlatformRole(ctx, userId, { roleKey: input.roleKey, reason: input.reason, expiresAt: input.expiresAt });
}

export const revokeRoleInput = z.object({ reason: reasonSchema, mfaCode: mfaCodeSchema });

export async function revokeRoleAssignment(ctx: RequestContext, assignmentId: string, raw: z.input<typeof revokeRoleInput>) {
  const input = revokeRoleInput.parse(raw);
  if (!isUuid(assignmentId)) throw notFound("Role assignment");
  await requirePermission(ctx, "platform.security.manage", platformChain());
  const a = await db().roleAssignment.findUnique({ where: { id: assignmentId }, select: { principalId: true } });
  if (!a) throw notFound("Role assignment");
  await recheckMfa(ctx, input.mfaCode);
  return revokePlatformRole(ctx, a.principalId, assignmentId, { reason: input.reason });
}

/** Revoke from the user page: the assignment must belong to that user; MFA re-check. */
export async function revokeUserRole(ctx: RequestContext, userId: string, assignmentId: string, raw: z.input<typeof revokeRoleInput>) {
  const input = revokeRoleInput.parse(raw);
  await requirePermission(ctx, "platform.security.manage", platformChain());
  await recheckMfa(ctx, input.mfaCode);
  return revokePlatformRole(ctx, userId, assignmentId, { reason: input.reason });
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

// ───────────── Custom platform roles ─────────────

/**
 * Custom platform roles are `roles` rows with organizationId NULL, isSystem false and assignableAt [PLATFORM]. Their
 * keys are lowercase (system keys are UPPER_CASE, so they never collide) and they may hold only platform-only
 * permissions. Built-in roles (SUPER_ADMIN included) are code-defined and immutable here: the seed rewrites them.
 * Every change needs platform.roles.manage (MFA-gated) plus a fresh authenticator code, and the editor may only put
 * permissions into a role that they hold themselves (no privilege design beyond one's own).
 */
export const PLATFORM_PERMISSION_KEYS = PERMISSIONS.filter((p) => p.platformOnly).map((p) => p.key);

const roleKey = z.string().trim().regex(/^[a-z][a-z0-9_-]{1,48}$/, "lowercase letters, digits, - or _ (2–49 characters)");
const permissionList = z.array(z.string().max(80)).min(1).max(PLATFORM_PERMISSION_KEYS.length);

export const createPlatformRoleInput = z.object({
  key: roleKey,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  permissions: permissionList,
  reason: reasonSchema,
  mfaCode: mfaCodeSchema,
});
export const updatePlatformRoleInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  permissions: permissionList.optional(),
  reason: reasonSchema,
  mfaCode: mfaCodeSchema,
});
export const clonePlatformRoleInput = z.object({ key: roleKey, name: z.string().trim().min(1).max(80), reason: reasonSchema, mfaCode: mfaCodeSchema });
export const deletePlatformRoleInput = z.object({ reason: reasonSchema, confirm: z.string().max(60), mfaCode: mfaCodeSchema });

/** Validate a custom platform role's permission set (pure; unit-tested). */
export function validatePlatformPermissions(perms: string[]): string[] {
  const unique = [...new Set(perms)];
  const bad = unique.filter((p) => !PLATFORM_ONLY.has(p));
  if (bad.length) throw invalid(`Only platform permissions can be in a platform role: ${bad.join(", ")}`, { reason: "not_platform_permission", permissions: bad });
  return unique.sort();
}

async function assertHoldsAll(ctx: RequestContext, perms: string[]) {
  for (const p of perms) {
    if (!(await can(ctx, p, platformChain()))) throw forbidden(`You do not hold ${p}`, { permission: p, reason: "no_self_escalation" });
  }
}

export async function customPlatformRoles() {
  const rows = await db().role.findMany({
    where: { organizationId: null, isSystem: false, assignableAt: { has: "PLATFORM" } },
    orderBy: { name: "asc" },
    select: { id: true, key: true, name: true, description: true, createdAt: true, updatedAt: true, permissions: { select: { permission: { select: { key: true } } } }, _count: { select: { assignments: true } } },
  });
  return rows.map(({ permissions, _count, ...r }) => ({ ...r, permissions: permissions.map((p) => p.permission.key).sort(), assignments: _count.assignments, custom: true as const }));
}

async function permissionIds(tx: Parameters<Parameters<typeof transaction>[0]>[0], keys: string[]) {
  const rows = await tx.permission.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
  if (rows.length !== keys.length) throw invalid("Unknown permission — run the seed", { reason: "permission_missing" });
  return rows;
}

async function writeRole(ctx: RequestContext, data: { key: string; name: string; description: string; permissions: string[] }, reason: string, action: string, from?: string) {
  return transaction(async (tx) => {
    if (await tx.role.findFirst({ where: { organizationId: null, key: data.key }, select: { id: true } })) throw conflict(`A role with key ${data.key} already exists`, { reason: "role_exists" });
    const perms = await permissionIds(tx, data.permissions);
    const role = await tx.role.create({
      data: { organizationId: null, key: data.key, name: data.name, description: data.description, isSystem: false, assignableAt: ["PLATFORM"], permissions: { create: perms.map((p) => ({ permissionId: p.id })) } },
    });
    await writeAudit(tx, ctx, { category: "SECURITY", action, resourceType: "role", resourceId: role.id, newValue: { key: role.key, name: role.name, permissions: data.permissions, ...(from ? { clonedFrom: from } : {}) }, reason });
    return { id: role.id, key: role.key };
  });
}

export async function createPlatformRole(ctx: RequestContext, raw: z.input<typeof createPlatformRoleInput>) {
  const input = createPlatformRoleInput.parse(raw);
  await requirePermission(ctx, "platform.roles.manage", platformChain());
  const perms = validatePlatformPermissions(input.permissions);
  await assertHoldsAll(ctx, perms);
  await recheckMfa(ctx, input.mfaCode);
  return writeRole(ctx, { key: input.key, name: input.name, description: input.description, permissions: perms }, input.reason, "platform.role.created");
}

/** Clone a built-in (by key) or custom (by id) platform role into a new custom role. */
export async function clonePlatformRole(ctx: RequestContext, source: string, raw: z.input<typeof clonePlatformRoleInput>) {
  const input = clonePlatformRoleInput.parse(raw);
  await requirePermission(ctx, "platform.roles.manage", platformChain());
  const sys = SYSTEM_ROLES.find((r) => r.key === source && r.assignableAt.includes("PLATFORM"));
  let perms: string[];
  let description: string;
  if (sys) {
    perms = sys.permissions;
    description = sys.description;
  } else {
    if (!isUuid(source)) throw notFound("Role");
    const custom = (await customPlatformRoles()).find((r) => r.id === source);
    if (!custom) throw notFound("Role");
    perms = custom.permissions;
    description = custom.description;
  }
  perms = validatePlatformPermissions(perms);
  await assertHoldsAll(ctx, perms);
  await recheckMfa(ctx, input.mfaCode);
  return writeRole(ctx, { key: input.key, name: input.name, description, permissions: perms }, input.reason, "platform.role.cloned", source);
}

async function loadCustom(tx: Parameters<Parameters<typeof transaction>[0]>[0], roleId: string) {
  if (!isUuid(roleId)) throw notFound("Role");
  const role = await tx.role.findUnique({ where: { id: roleId }, select: { id: true, key: true, name: true, description: true, isSystem: true, organizationId: true, assignableAt: true, permissions: { select: { permission: { select: { key: true } } } } } });
  if (!role || role.organizationId || !role.assignableAt.includes("PLATFORM")) throw notFound("Role");
  if (role.isSystem) throw forbidden("Built-in platform roles cannot be changed; clone one instead", { reason: "system_role" });
  return { ...role, permissions: role.permissions.map((p) => p.permission.key).sort() };
}

export async function updatePlatformRole(ctx: RequestContext, roleId: string, raw: z.input<typeof updatePlatformRoleInput>) {
  const input = updatePlatformRoleInput.parse(raw);
  await requirePermission(ctx, "platform.roles.manage", platformChain());
  const next = input.permissions ? validatePlatformPermissions(input.permissions) : null;
  if (next) await assertHoldsAll(ctx, next);
  await recheckMfa(ctx, input.mfaCode);
  const result = await transaction(async (tx) => {
    const role = await loadCustom(tx, roleId);
    const data: { name?: string; description?: string } = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    await tx.role.update({ where: { id: roleId }, data });
    if (next) {
      const perms = await permissionIds(tx, next);
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });
    }
    const added = next ? next.filter((p) => !role.permissions.includes(p)) : [];
    const removed = next ? role.permissions.filter((p) => !next.includes(p)) : [];
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.role.updated", resourceType: "role", resourceId: roleId, oldValue: { name: role.name, description: role.description, permissions: role.permissions }, newValue: { ...data, ...(next ? { permissions: next, added, removed } : {}) }, reason: input.reason });
    return { id: roleId, added, removed };
  });
  invalidateGrants(ctx);
  return result;
}

/** Delete a custom platform role — only once nobody holds it (revoke its grants first); typed confirmation: its key. */
export async function deletePlatformRole(ctx: RequestContext, roleId: string, raw: z.input<typeof deletePlatformRoleInput>) {
  const input = deletePlatformRoleInput.parse(raw);
  await requirePermission(ctx, "platform.roles.manage", platformChain());
  await recheckMfa(ctx, input.mfaCode);
  return transaction(async (tx) => {
    const role = await loadCustom(tx, roleId);
    requireConfirmation(input.confirm, role.key);
    const holders = await tx.roleAssignment.count({ where: { roleId } });
    if (holders) throw conflict("Revoke every grant of this role first", { reason: "role_in_use", holders });
    await tx.role.delete({ where: { id: roleId } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.role.deleted", resourceType: "role", resourceId: roleId, oldValue: { key: role.key, name: role.name, permissions: role.permissions }, reason: input.reason });
    return { id: roleId };
  });
}

/** One platform role (built-in by key, custom by id) with its holders, for /roles/[roleId]. */
export async function getPlatformRole(ctx: RequestContext, idOrKey: string) {
  await requireAnyPlatform(ctx, ["platform.security.read", "platform.security.manage", "platform.users.read", "platform.roles.manage"]);
  const sys = SYSTEM_ROLES.find((r) => r.key === idOrKey && r.assignableAt.some((s) => isPlatformScope(s)));
  const row = sys
    ? await db().role.findFirst({ where: { organizationId: null, key: sys.key }, select: { id: true } })
    : isUuid(idOrKey)
      ? await db().role.findFirst({ where: { id: idOrKey, organizationId: null, isSystem: false, assignableAt: { has: "PLATFORM" } }, select: { id: true } })
      : null;
  if (!row) throw notFound("Role");
  const role = await db().role.findUniqueOrThrow({ where: { id: row.id }, select: { id: true, key: true, name: true, description: true, isSystem: true, createdAt: true, updatedAt: true, permissions: { select: { permission: { select: { key: true } } } } } });
  const assignments = await db().roleAssignment.findMany({ where: { roleId: row.id }, orderBy: { createdAt: "asc" }, take: 1000, select: { id: true, principalId: true, scopeType: true, scopeId: true, expiresAt: true, createdAt: true, grantedById: true } });
  const ids = [...new Set(assignments.flatMap((a) => [a.principalId, a.grantedById].filter((x): x is string => !!x)))];
  const users = ids.length ? await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, mfaEnabled: true, status: true } }) : [];
  const history = await db().auditLog.findMany({ where: { resourceType: "role", resourceId: row.id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, actorId: true, reason: true, oldValue: true, newValue: true, createdAt: true } });
  return {
    ...role,
    builtIn: role.isSystem,
    permissions: role.permissions.map((p) => p.permission.key).sort(),
    holders: assignments.map((a) => ({ ...a, user: users.find((u) => u.id === a.principalId) ?? null, grantedBy: users.find((u) => u.id === a.grantedById)?.name ?? null })),
    history: history.map((h) => ({ ...h, actor: users.find((u) => u.id === h.actorId)?.name ?? null })),
  };
}

// ───────────── Permission matrix, effective permissions, diff ─────────────

export interface MatrixRole {
  id: string | null;
  key: string;
  name: string;
  builtIn: boolean;
  permissions: string[];
}

/** Roles × platform permissions grid (built-in from the catalog, custom from the database). */
export async function permissionMatrix(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.security.read", "platform.security.manage", "platform.users.read", "platform.roles.manage"]);
  const custom = await customPlatformRoles();
  const roles: MatrixRole[] = [
    ...SYSTEM_ROLES.filter((r) => r.assignableAt.some((s) => isPlatformScope(s))).map((r) => ({ id: null, key: r.key, name: r.name, builtIn: true, permissions: r.permissions.filter((p) => PLATFORM_ONLY.has(p)).sort() })),
    ...custom.map((r) => ({ id: r.id, key: r.key, name: r.name, builtIn: false, permissions: r.permissions })),
  ];
  const permissions = PERMISSIONS.filter((p) => p.platformOnly).map((p) => ({ key: p.key, description: p.description, mfa: MFA_GATED.has(p.key), group: p.key.startsWith("platform.") ? p.key.split(".")[1]! : p.key.split(".")[0]! }));
  return { roles, permissions };
}

/** Pure diff of two permission sets (unit-tested). */
export function diffPermissions(a: readonly string[], b: readonly string[]) {
  const A = new Set(a);
  const B = new Set(b);
  return { onlyA: [...A].filter((p) => !B.has(p)).sort(), onlyB: [...B].filter((p) => !A.has(p)).sort(), both: [...A].filter((p) => B.has(p)).sort() };
}

/** Effective platform permissions of one admin: each key with the grants that give it (expired grants excluded). */
export async function effectivePlatformPermissions(ctx: RequestContext, userId: string) {
  await requireAnyPlatform(ctx, ["platform.security.read", "platform.security.manage", "platform.users.read", "platform.roles.manage"]);
  if (!isUuid(userId)) throw notFound("User");
  const grants = (await loadGrants(db(), "USER", userId)).filter((g) => isPlatformScope(g.scopeType));
  const keys = PERMISSIONS.filter((p) => p.platformOnly).map((p) => p.key);
  return keys
    .map((k) => ({ key: k, mfa: MFA_GATED.has(k), via: grants.filter((g) => g.permissions.has(k) && g.scopeType === "PLATFORM").map((g) => g.roleKey) }))
    .filter((r) => r.via.length > 0);
}

// ───────────── Break-glass ─────────────

export const BREAK_GLASS_MAX_MINUTES = 240;
export const BREAK_GLASS_PHRASE = "BREAK GLASS";
export const breakGlassInput = z.object({
  minutes: z.coerce.number().int().min(15).max(BREAK_GLASS_MAX_MINUTES).default(60),
  reason: z.string().trim().min(20).max(500),
  confirm: z.string().max(40),
  mfaCode: mfaCodeSchema,
});

/**
 * Break-glass: a security administrator (platform.security.manage) takes SUPER_ADMIN for at most 4 hours in an
 * emergency, without a second super admin. This is the one place the no-self-escalation rule is waived, so it needs
 * a fresh MFA code, a ≥20-character reason, the typed phrase "BREAK GLASS", is never extendable while active, notifies
 * every security reader, and expires on its own (rbac ignores the grant after expiresAt; the people jobs delete it).
 */
export async function breakGlass(ctx: RequestContext, raw: z.input<typeof breakGlassInput>) {
  const input = breakGlassInput.parse(raw);
  await requirePermission(ctx, "platform.security.manage", platformChain());
  requireConfirmation(input.confirm, BREAK_GLASS_PHRASE);
  await recheckMfa(ctx, input.mfaCode);
  const userId = ctx.actor.id!;
  const expiresAt = new Date(Date.now() + input.minutes * 60_000);
  const result = await transaction(async (tx) => {
    const roleId = (await tx.role.findFirst({ where: { organizationId: null, key: "SUPER_ADMIN" }, select: { id: true } }))?.id;
    if (!roleId) throw invalid("System role SUPER_ADMIN missing — run the seed");
    const existing = await tx.roleAssignment.findUnique({ where: { principalType_principalId_roleId_scopeType_scopeId: { principalType: "USER", principalId: userId, roleId, scopeType: "PLATFORM", scopeId: "*" } } });
    if (existing && (!existing.expiresAt || existing.expiresAt > new Date())) throw conflict("You already hold SUPER_ADMIN", { reason: "already_super_admin" });
    if (existing) await tx.roleAssignment.delete({ where: { id: existing.id } });
    const a = await tx.roleAssignment.create({ data: { principalType: "USER", principalId: userId, roleId, scopeType: "PLATFORM", scopeId: "*", grantedById: userId, expiresAt } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.break_glass", resourceType: "user", resourceId: userId, newValue: { roleKey: "SUPER_ADMIN", assignmentId: a.id, expiresAt, minutes: input.minutes }, reason: input.reason });
    return { assignmentId: a.id, expiresAt };
  });
  invalidateGrants(ctx);
  await notifyAdmins(ctx, { permission: "platform.security.read", type: "security.break_glass", severity: "CRITICAL", title: "Break-glass SUPER_ADMIN activated", href: `/users/${userId}`, dedupeKey: `break-glass:${result.assignmentId}` }).catch(() => undefined);
  return result;
}

/** Active and recent break-glass grants (for the roles page banner). */
export async function breakGlassState(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.security.read", "platform.security.manage", "platform.roles.manage"]);
  const rows = await db().auditLog.findMany({ where: { action: "platform.break_glass" }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, actorId: true, reason: true, newValue: true, createdAt: true } });
  const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const users = ids.length ? await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const now = Date.now();
  return rows.map((r) => {
    const v = (r.newValue ?? {}) as { expiresAt?: string; assignmentId?: string };
    const exp = v.expiresAt ? new Date(v.expiresAt) : null;
    return { id: r.id, assignmentId: v.assignmentId ?? null, user: users.find((u) => u.id === r.actorId) ?? null, reason: r.reason, startedAt: r.createdAt, expiresAt: exp, active: !!exp && exp.getTime() > now };
  });
}

// ───────────── Permission history ─────────────

const PERMISSION_ACTIONS = [
  "platform.role_granted",
  "platform.role_revoked",
  "platform.role_expired",
  "platform.role.created",
  "platform.role.cloned",
  "platform.role.updated",
  "platform.role.deleted",
  "platform.break_glass",
  "platform.access_review.created",
  "platform.access_review.decided",
  "platform.access_review.completed",
];

/** Platform permission change history (grants, revocations, expiries, role edits, break-glass, reviews). */
export async function permissionHistory(ctx: RequestContext, raw: { cursor?: string; limit?: number } = {}) {
  await requireAnyPlatform(ctx, ["platform.security.read", "platform.audit.read", "platform.roles.manage"]);
  const limit = Math.min(Math.max(Number(raw.limit) || 50, 1), 200);
  const cursor = raw.cursor && isUuid(raw.cursor) ? raw.cursor : undefined;
  const rows = await db().auditLog.findMany({
    where: { action: { in: PERMISSION_ACTIONS } },
    orderBy: { id: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, action: true, actorId: true, actorType: true, resourceType: true, resourceId: true, reason: true, oldValue: true, newValue: true, createdAt: true },
  });
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const ids = [...new Set(page.flatMap((r) => [r.actorId, r.resourceType === "user" ? r.resourceId : null]).filter((x): x is string => !!x && isUuid(x)))];
  const users = ids.length ? await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  return { nextCursor: more ? page[page.length - 1]!.id : null, data: page.map((r) => ({ ...r, actor: users.find((u) => u.id === r.actorId) ?? null, subject: r.resourceType === "user" ? (users.find((u) => u.id === r.resourceId) ?? null) : null })) };
}

export { MAX_GRANT_DAYS };
