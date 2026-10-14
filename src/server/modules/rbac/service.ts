import { z } from "zod";
import type { PrincipalType, ScopeType } from "@/generated/prisma/enums";
import { db, transaction, type Tx, type Db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { env } from "@/server/core/env";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { MFA_GATED, NEVER_FOR_AGENTS, PERMISSION_KEYS, PLATFORM_ONLY } from "./catalog";
import { chainFor, chainOrganization, isPlatformScope, orgChain, type ScopeChain, type ScopeRef } from "./scope";

export interface Grant {
  assignmentId: string;
  roleKey: string;
  scopeType: ScopeType;
  scopeId: string;
  permissions: Set<string>;
}

export const MFA_FRESHNESS_MS = 12 * 60 * 60 * 1000;

/** Per-request memo of a principal's grants (one indexed query per principal per request). */
const grantCache = new WeakMap<RequestContext, Promise<Grant[]>>();

export async function loadGrants(client: Tx | Db, principalType: PrincipalType, principalId: string): Promise<Grant[]> {
  const now = new Date();
  const rows = await client.roleAssignment.findMany({
    where: { principalType, principalId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: {
      id: true,
      scopeType: true,
      scopeId: true,
      role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } },
    },
  });
  return rows.map((r) => ({
    assignmentId: r.id,
    roleKey: r.role.key,
    scopeType: r.scopeType,
    scopeId: r.scopeId,
    permissions: new Set(r.role.permissions.map((p) => p.permission.key)),
  }));
}

function grantsFor(ctx: RequestContext, client?: Tx | Db): Promise<Grant[]> {
  const { type, id } = ctx.actor;
  if (type === "SYSTEM" || !id) return Promise.resolve([]);
  // Inside a transaction, read through it (sees uncommitted grants of the same tx); otherwise memoize.
  if (client) return loadGrants(client, type as PrincipalType, id);
  let cached = grantCache.get(ctx);
  if (!cached) {
    cached = loadGrants(db(), type as PrincipalType, id);
    grantCache.set(ctx, cached);
  }
  return cached;
}

/** Drop memoized grants (after a grant/revoke within the same request). */
export function invalidateGrants(ctx: RequestContext) {
  grantCache.delete(ctx);
}

async function isActiveMember(client: Tx | Db, organizationId: string, userId: string): Promise<boolean> {
  const m = await client.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { status: true },
  });
  return m?.status === "ACTIVE";
}

export function grantsAllow(grants: Grant[], permission: string, chain: ScopeChain): boolean {
  const platformOnly = PLATFORM_ONLY.has(permission);
  return grants.some(
    (g) =>
      g.permissions.has(permission) &&
      (!platformOnly || isPlatformScope(g.scopeType)) &&
      chain.some((s) => s.type === g.scopeType && s.id === g.scopeId),
  );
}

/** Does the acting principal hold `permission` anywhere on `chain`? SYSTEM actors are trusted internal code. */
export async function can(ctx: RequestContext, permission: string, chain: ScopeChain, client?: Tx | Db): Promise<boolean> {
  if (!PERMISSION_KEYS.has(permission)) throw new Error(`Unknown permission ${permission}`);
  if (ctx.actor.type === "SYSTEM") return true;
  const orgId = chainOrganization(chain);
  if (orgId && ctx.actor.type === "USER" && !(await isActiveMember(client ?? db(), orgId, ctx.actor.id!))) {
    return false;
  }
  return grantsAllow(await grantsFor(ctx, client), permission, chain);
}

export function mfaSatisfied(ctx: RequestContext): boolean {
  if (ctx.actor.type !== "USER") return true; // non-human principals authenticate with keys; MFA applies to people
  if (env().REALY_DEV_RELAX_MFA) return true;
  return !!ctx.mfaVerifiedAt && Date.now() - ctx.mfaVerifiedAt.getTime() < MFA_FRESHNESS_MS;
}

/**
 * Authorize or throw. A user who is not a member of the chain's organization gets `not_found`
 * (existence is not leaked); a member lacking the permission gets `forbidden`.
 */
export async function requirePermission(
  ctx: RequestContext,
  permission: string,
  chain: ScopeChain,
  client?: Tx | Db,
): Promise<void> {
  if (ctx.actor.type === "SYSTEM") return;
  const orgId = chainOrganization(chain);
  if (orgId && ctx.actor.type === "USER" && !(await isActiveMember(client ?? db(), orgId, ctx.actor.id!))) {
    throw notFound("Organization");
  }
  if (!(await can(ctx, permission, chain, client))) {
    const where = chain[0] ? `${chain[0].type}:${chain[0].id}` : "?";
    throw forbidden(`Missing permission ${permission} at ${where}`, { permission });
  }
  if (MFA_GATED.has(permission) && !mfaSatisfied(ctx)) {
    throw new AppError("mfa_required", `Permission ${permission} requires a recent MFA verification`, { permission });
  }
}

/** Effective permission keys for the actor at a chain (for UI capability hints only — never for enforcement). */
export async function effectivePermissions(ctx: RequestContext, chain: ScopeChain): Promise<string[]> {
  if (ctx.actor.type === "SYSTEM") return [...PERMISSION_KEYS];
  const orgId = chainOrganization(chain);
  if (orgId && ctx.actor.type === "USER" && !(await isActiveMember(db(), orgId, ctx.actor.id!))) return [];
  const grants = await grantsFor(ctx);
  return [...PERMISSION_KEYS].filter((p) => grantsAllow(grants, p, chain));
}

// ───────────── Role assignment ─────────────

export const assignRoleInput = z.object({
  principalType: z.enum(["USER", "SERVICE_ACCOUNT", "AGENT"]),
  principalId: z.string().uuid(),
  roleId: z.string().uuid(),
  scopeType: z.enum(["PLATFORM", "REGION", "COUNTRY", "ORGANIZATION", "COMPANY", "WORKSPACE", "PROJECT"]),
  scopeId: z.string().min(1).max(64),
  expiresAt: z.coerce.date().optional(),
});
export type AssignRoleInput = z.infer<typeof assignRoleInput>;

async function principalBelongsToOrg(tx: Tx, type: PrincipalType, id: string, orgId: string): Promise<boolean> {
  if (type === "USER") return isActiveMember(tx, orgId, id);
  if (type === "SERVICE_ACCOUNT") {
    return !!(await tx.serviceAccount.findFirst({ where: { id, organizationId: orgId, disabledAt: null } }));
  }
  // AGENT principals arrive with the workforce module (Phase 4).
  return false;
}

/**
 * Grant a role at a scope, enforcing docs/rbac.md rules: scope compatibility, tenant ownership,
 * `roles.assign` (or `platform.security.manage` for platform scopes), and no self-escalation.
 * `organizationId` is the tenant the request was made in (null for platform scopes).
 */
export async function assignRole(
  ctx: RequestContext,
  organizationId: string | null,
  raw: AssignRoleInput,
  existingTx?: Tx,
): Promise<{ id: string }> {
  const input = assignRoleInput.parse(raw);
  const run = async (tx: Tx) => {
    const role = await tx.role.findUnique({
      where: { id: input.roleId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role || (role.organizationId && role.organizationId !== organizationId)) throw notFound("Role");
    if (!role.assignableAt.includes(input.scopeType)) {
      throw invalid(`Role ${role.key} cannot be assigned at ${input.scopeType} scope`);
    }
    const platform = isPlatformScope(input.scopeType);
    if (platform && organizationId) throw invalid("Platform-scoped roles cannot be granted inside an organization");
    if (!platform && !organizationId) throw invalid("Tenant-scoped roles require an organization");

    const scope: ScopeRef = { type: input.scopeType, id: input.scopeId };
    const chain = await chainFor(tx, scope, organizationId);
    const permissions = role.permissions.map((rp) => rp.permission.key);

    if (input.principalType === "AGENT") {
      const bad = permissions.filter((p) => NEVER_FOR_AGENTS.has(p));
      if (bad.length) throw forbidden(`Role grants permissions never assignable to AI identities: ${bad.join(", ")}`);
    }
    if (organizationId && !(await principalBelongsToOrg(tx, input.principalType, input.principalId, organizationId))) {
      throw notFound("Principal");
    }

    await requirePermission(ctx, platform ? "platform.security.manage" : "roles.assign", chain, tx);
    for (const p of permissions) {
      if (!(await can(ctx, p, chain, tx))) {
        throw forbidden(`Cannot grant ${role.key}: you do not hold ${p} at this scope`, { permission: p });
      }
    }

    const existing = await tx.roleAssignment.findUnique({
      where: {
        principalType_principalId_roleId_scopeType_scopeId: {
          principalType: input.principalType,
          principalId: input.principalId,
          roleId: role.id,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
        },
      },
    });
    if (existing) throw conflict("Role already assigned at this scope");

    const assignment = await tx.roleAssignment.create({
      data: {
        principalType: input.principalType,
        principalId: input.principalId,
        roleId: role.id,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        organizationId,
        grantedById: ctx.actor.id,
        expiresAt: input.expiresAt ?? null,
      },
    });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "role.assigned",
      resourceType: "role_assignment",
      resourceId: assignment.id,
      newValue: { roleKey: role.key, ...input },
    });
    await emitEvent(
      tx,
      ctx,
      "role.assigned",
      {
        assignmentId: assignment.id,
        roleKey: role.key,
        principalType: input.principalType,
        principalId: input.principalId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      },
      { organizationId, aggregateType: "role_assignment", aggregateId: assignment.id },
    );
    return { id: assignment.id };
  };
  const result = existingTx ? await run(existingTx) : await transaction(run);
  invalidateGrants(ctx);
  return result;
}

export async function revokeAssignment(ctx: RequestContext, organizationId: string | null, assignmentId: string) {
  await transaction(async (tx) => {
    const a = await tx.roleAssignment.findUnique({ where: { id: assignmentId }, include: { role: true } });
    if (!a || a.organizationId !== organizationId) throw notFound("Role assignment");
    const chain = await chainFor(tx, { type: a.scopeType, id: a.scopeId }, organizationId);
    await requirePermission(ctx, isPlatformScope(a.scopeType) ? "platform.security.manage" : "roles.assign", chain, tx);
    if (a.role.key === "ORGANIZATION_OWNER") {
      const owners = await tx.roleAssignment.count({
        where: { organizationId, scopeType: "ORGANIZATION", role: { key: "ORGANIZATION_OWNER", organizationId: null } },
      });
      if (owners <= 1) throw conflict("An organization must keep at least one owner");
    }
    await tx.roleAssignment.delete({ where: { id: a.id } });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "role.revoked",
      resourceType: "role_assignment",
      resourceId: a.id,
      oldValue: { roleKey: a.role.key, principalType: a.principalType, principalId: a.principalId, scopeType: a.scopeType, scopeId: a.scopeId },
    });
    await emitEvent(tx, ctx, "role.revoked", { assignmentId: a.id }, { organizationId, aggregateType: "role_assignment", aggregateId: a.id });
  });
  invalidateGrants(ctx);
}

// ───────────── Custom roles ─────────────

export const customRoleInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{1,48}$/, "lowercase letters, digits, - or _"),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  permissions: z.array(z.string()).min(1).max(200),
});

export async function createCustomRole(ctx: RequestContext, organizationId: string, raw: z.input<typeof customRoleInput>) {
  const input = customRoleInput.parse(raw);
  const chain = orgChain(organizationId);
  return transaction(async (tx) => {
    await requirePermission(ctx, "roles.manage", chain, tx);
    const unknown = input.permissions.filter((p) => !PERMISSION_KEYS.has(p));
    if (unknown.length) throw invalid(`Unknown permissions: ${unknown.join(", ")}`);
    const platformOnly = input.permissions.filter((p) => PLATFORM_ONLY.has(p));
    if (platformOnly.length) throw forbidden(`Platform-only permissions cannot be in a custom role: ${platformOnly.join(", ")}`);
    for (const p of input.permissions) {
      if (!(await can(ctx, p, chain, tx))) throw forbidden(`You do not hold ${p}`, { permission: p });
    }
    const dup = await tx.role.findFirst({ where: { organizationId, key: input.key } });
    if (dup) throw conflict(`Role ${input.key} already exists`);

    const perms = await tx.permission.findMany({ where: { key: { in: input.permissions } }, select: { id: true, key: true } });
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
      newValue: { key: role.key, name: role.name, permissions: input.permissions },
    });
    await emitEvent(tx, ctx, "role.created", { roleId: role.id, key: role.key, permissions: input.permissions }, {
      organizationId,
      aggregateType: "role",
      aggregateId: role.id,
    });
    return role;
  });
}

export async function listRoles(ctx: RequestContext, organizationId: string) {
  await requirePermission(ctx, "roles.read", orgChain(organizationId));
  return db().role.findMany({
    where: { OR: [{ organizationId }, { organizationId: null, assignableAt: { hasSome: ["ORGANIZATION", "COMPANY", "WORKSPACE", "PROJECT"] } }] },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    include: { permissions: { include: { permission: { select: { key: true } } } } },
  });
}

export async function systemRoleId(client: Tx | Db, key: string): Promise<string> {
  const role = await client.role.findFirst({ where: { organizationId: null, key }, select: { id: true } });
  if (!role) throw new Error(`System role ${key} missing — run the seed`);
  return role.id;
}
