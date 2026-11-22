import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { PERMISSION_KEYS, PERMISSIONS, PLATFORM_ONLY } from "@/server/modules/rbac/catalog";
import { can, customRoleInput } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { authorizeOrg } from "./policy";

/** Roles managed by API keys (one per key) are hidden from the role builder. */
export const API_KEY_ROLE_PREFIX = "api-key-";

/** Tenant permissions grouped by area for the permission matrix. */
export function permissionGroups(): {
  area: string;
  permissions: { key: string; action: string; description: string }[];
}[] {
  const groups = new Map<string, { key: string; action: string; description: string }[]>();
  for (const p of PERMISSIONS) {
    if (p.platformOnly) continue;
    const area = p.key.slice(0, p.key.lastIndexOf("."));
    const list = groups.get(area) ?? [];
    list.push({
      key: p.key,
      action: p.key.slice(p.key.lastIndexOf(".") + 1),
      description: p.description,
    });
    groups.set(area, list);
  }
  return [...groups.entries()].map(([area, permissions]) => ({
    area,
    permissions,
  }));
}

async function assertGrantable(tx: Tx, ctx: RequestContext, organizationId: string, permissions: string[]) {
  const unknown = permissions.filter((p) => !PERMISSION_KEYS.has(p));
  if (unknown.length) throw invalid(`Unknown permissions: ${unknown.join(", ")}`);
  const platform = permissions.filter((p) => PLATFORM_ONLY.has(p));
  if (platform.length) throw forbidden(`Platform-only permissions cannot be in a custom role: ${platform.join(", ")}`);
  for (const p of permissions) {
    if (!(await can(ctx, p, orgChain(organizationId), tx)))
      throw forbidden(`You do not hold ${p}`, {
        permission: p,
        reason: "enterprise_permission_not_held",
      });
  }
}

/**
 * Create a custom role inside the caller's transaction (same rules as rbac.createCustomRole: roles.manage, known
 * tenant permissions only, no escalation). Used by the role builder and by marketplace template installs.
 */
export async function createRoleInTx(tx: Tx, ctx: RequestContext, organizationId: string, raw: z.input<typeof customRoleInput>, opts: { audited?: string } = {}) {
  const input = customRoleInput.parse(raw);
  await authorizeOrg(ctx, organizationId, "roles.manage", tx);
  if (input.key.startsWith(API_KEY_ROLE_PREFIX))
    throw invalid("This key prefix is reserved", {
      reason: "enterprise_reserved_role_key",
    });
  await assertGrantable(tx, ctx, organizationId, input.permissions);
  if (await tx.role.findFirst({ where: { organizationId, key: input.key } })) throw conflict(`Role ${input.key} already exists`);
  const perms = await tx.permission.findMany({
    where: { key: { in: input.permissions } },
    select: { id: true },
  });
  const role = await tx.role.create({
    data: {
      organizationId,
      key: input.key,
      name: input.name,
      description: input.description,
      isSystem: false,
      assignableAt: ["ORGANIZATION", "COMPANY", "WORKSPACE", "PROJECT"],
      permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
    },
  });
  await writeAudit(tx, ctx, {
    category: "SECURITY",
    organizationId,
    action: "role.created",
    resourceType: "role",
    resourceId: role.id,
    newValue: {
      key: role.key,
      name: role.name,
      permissions: input.permissions,
    },
    reason: opts.audited ?? null,
  });
  await emitEvent(tx, ctx, "role.created", { roleId: role.id, key: role.key, permissions: input.permissions }, { organizationId, aggregateType: "role", aggregateId: role.id });
  return role;
}

export async function createRole(ctx: RequestContext, organizationId: string, raw: z.input<typeof customRoleInput>) {
  return transaction((tx) => createRoleInTx(tx, ctx, organizationId, raw));
}

export const updateRoleInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  permissions: z.array(z.string()).min(1).max(200),
});

async function customRole(tx: Tx, organizationId: string, roleId: string) {
  if (!z.string().uuid().safeParse(roleId).success) throw notFound("Role");
  const role = await tx.role.findFirst({
    where: { id: roleId, organizationId },
    include: {
      permissions: { include: { permission: { select: { key: true } } } },
    },
  });
  if (!role) throw notFound("Role");
  if (role.isSystem || role.key.startsWith(API_KEY_ROLE_PREFIX))
    throw forbidden("System and API-key roles cannot be changed here", {
      reason: "enterprise_role_locked",
    });
  return role;
}

/** Edit a custom role. Adding a permission requires holding it; removing never does. */
export async function updateRole(ctx: RequestContext, organizationId: string, roleId: string, raw: z.input<typeof updateRoleInput>) {
  const input = updateRoleInput.parse(raw);
  return transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "roles.manage", tx);
    const role = await customRole(tx, organizationId, roleId);
    const before = role.permissions.map((p) => p.permission.key);
    const next = [...new Set(input.permissions)];
    await assertGrantable(
      tx,
      ctx,
      organizationId,
      next.filter((p) => !before.includes(p)),
    );
    const unknown = next.filter((p) => !PERMISSION_KEYS.has(p) || PLATFORM_ONLY.has(p));
    if (unknown.length) throw invalid(`Invalid permissions: ${unknown.join(", ")}`);
    const perms = await tx.permission.findMany({
      where: { key: { in: next } },
      select: { id: true },
    });
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    await tx.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
    const updated = await tx.role.update({
      where: { id: role.id },
      data: { name: input.name, description: input.description },
    });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "role.updated",
      resourceType: "role",
      resourceId: role.id,
      oldValue: { name: role.name, permissions: before },
      newValue: { name: input.name, permissions: next },
    });
    return updated;
  });
}

/** Delete a custom role and its assignments. */
export async function deleteRole(ctx: RequestContext, organizationId: string, roleId: string) {
  await transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "roles.manage", tx);
    const role = await customRole(tx, organizationId, roleId);
    const pending = await tx.invitation.count({
      where: {
        roleId: role.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (pending)
      throw conflict("Pending invitations use this role", {
        reason: "enterprise_role_in_use",
      });
    const assignments = await tx.roleAssignment.count({
      where: { roleId: role.id },
    });
    await tx.role.delete({ where: { id: role.id } });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "role.deleted",
      resourceType: "role",
      resourceId: role.id,
      oldValue: { key: role.key, name: role.name, assignments },
    });
  });
}

/** Everything the role builder and the access view need. */
export async function roleBuilderData(ctx: RequestContext, organizationId: string) {
  await authorizeOrg(ctx, organizationId, "roles.read");
  const [roles, members, companies, assignments] = await Promise.all([
    db().role.findMany({
      where: {
        OR: [
          { organizationId, NOT: { key: { startsWith: API_KEY_ROLE_PREFIX } } },
          {
            organizationId: null,
            assignableAt: {
              hasSome: ["ORGANIZATION", "COMPANY", "WORKSPACE", "PROJECT"],
            },
          },
        ],
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      include: {
        permissions: { include: { permission: { select: { key: true } } } },
      },
    }),
    db().membership.findMany({
      where: { organizationId },
      include: {
        user: {
          select: { id: true, name: true, email: true, mfaEnabled: true },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 2000, // B35: upper bound per view
    }),
    db().company.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db().roleAssignment.findMany({
      where: { organizationId, principalType: "USER" },
      include: { role: { select: { id: true, key: true, name: true } } },
      take: 20_000, // B35: upper bound per view
    }),
  ]);
  return {
    roles: roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      assignableAt: r.assignableAt,
      permissions: r.permissions.map((p) => p.permission.key).sort(),
      // System role assignment counts span all organizations; only count this organization's.
      assignments: assignments.filter((a) => a.roleId === r.id).length,
    })),
    members: members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      mfaEnabled: m.user.mfaEnabled,
      status: m.status,
    })),
    companies,
    assignments: assignments.map((a) => ({
      id: a.id,
      userId: a.principalId,
      roleId: a.role.id,
      roleName: a.role.name,
      roleKey: a.role.key,
      scopeType: a.scopeType,
      scopeId: a.scopeId,
      expiresAt: a.expiresAt,
    })),
  };
}

/** Who has what: for every member, each permission with the scopes it is granted at. */
export async function accessMatrix(ctx: RequestContext, organizationId: string) {
  await authorizeOrg(ctx, organizationId, "roles.read");
  await authorizeOrg(ctx, organizationId, "users.read");
  const data = await roleBuilderData(ctx, organizationId);
  const rolePerms = new Map(data.roles.map((r) => [r.id, r.permissions]));
  const now = Date.now();
  return data.members.map((m) => {
    const perms = new Map<string, { scopeType: string; scopeId: string; role: string }[]>();
    for (const a of data.assignments) {
      if (a.userId !== m.userId || (a.expiresAt && a.expiresAt.getTime() < now)) continue;
      for (const p of rolePerms.get(a.roleId) ?? []) {
        const list = perms.get(p) ?? [];
        list.push({
          scopeType: a.scopeType,
          scopeId: a.scopeId,
          role: a.roleName,
        });
        perms.set(p, list);
      }
    }
    return { ...m, permissions: Object.fromEntries(perms) };
  });
}
