import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { randomToken, sha256 } from "@/server/core/crypto";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { can, requirePermission, systemRoleId } from "@/server/modules/rbac/service";
import { chainFor, isPlatformScope, orgChain } from "@/server/modules/rbac/scope";
import { closestLocale } from "@/i18n/config";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "org";
}

async function uniqueOrgSlug(tx: Tx, name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    if (!(await tx.organization.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function requireUser(ctx: RequestContext): string {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("Only users can perform this action");
  return ctx.actor.id;
}

export const createOrganizationInput = z.object({
  name: z.string().trim().min(1).max(120),
  defaultLocale: z.string().max(35).optional(),
});

/** Create an organization; the creator becomes its member and ORGANIZATION_OWNER. */
export async function createOrganization(ctx: RequestContext, raw: z.input<typeof createOrganizationInput>) {
  const userId = requireUser(ctx);
  const input = createOrganizationInput.parse(raw);
  return transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: input.name,
        slug: await uniqueOrgSlug(tx, input.name),
        defaultLocale: closestLocale(input.defaultLocale),
        createdById: userId,
      },
    });
    await tx.membership.create({ data: { organizationId: org.id, userId } });
    // Bootstrap grant: nobody holds roles.assign in a brand-new organization, so this is written directly.
    const assignment = await tx.roleAssignment.create({
      data: {
        principalType: "USER",
        principalId: userId,
        roleId: await systemRoleId(tx, "ORGANIZATION_OWNER"),
        scopeType: "ORGANIZATION",
        scopeId: org.id,
        organizationId: org.id,
        grantedById: userId,
      },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId: org.id,
      action: "organization.created",
      resourceType: "organization",
      resourceId: org.id,
      newValue: { name: org.name, slug: org.slug },
    });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId: org.id,
      action: "role.assigned",
      resourceType: "role_assignment",
      resourceId: assignment.id,
      newValue: { roleKey: "ORGANIZATION_OWNER", principalId: userId, scopeType: "ORGANIZATION", scopeId: org.id },
      reason: "organization creator",
    });
    await emitEvent(tx, ctx, "organization.created", { organizationId: org.id, name: org.name }, {
      organizationId: org.id,
      aggregateType: "organization",
      aggregateId: org.id,
    });
    return org;
  });
}

/** Organizations the acting user is an active member of. */
export async function listMyOrganizations(ctx: RequestContext) {
  const userId = requireUser(ctx);
  return db().organization.findMany({
    where: { memberships: { some: { userId, status: "ACTIVE" } }, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true, defaultLocale: true },
  });
}

export async function getOrganization(ctx: RequestContext, organizationId: string) {
  await requirePermission(ctx, "organizations.read", orgChain(organizationId));
  const org = await db().organization.findUnique({ where: { id: organizationId } });
  if (!org) throw notFound("Organization");
  return org;
}

export async function listMembers(ctx: RequestContext, organizationId: string) {
  await requirePermission(ctx, "users.read", orgChain(organizationId));
  const members = await db().membership.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, email: true, mfaEnabled: true } } },
  });
  const assignments = await db().roleAssignment.findMany({
    where: { organizationId, principalType: "USER" },
    include: { role: { select: { key: true, name: true } } },
  });
  return members.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    mfaEnabled: m.user.mfaEnabled,
    status: m.status,
    roles: assignments
      .filter((a) => a.principalId === m.userId)
      .map((a) => ({ assignmentId: a.id, key: a.role.key, name: a.role.name, scopeType: a.scopeType, scopeId: a.scopeId })),
  }));
}

// ───────────── Invitations ─────────────

export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  roleId: z.string().uuid(),
  scopeType: z.enum(["ORGANIZATION", "COMPANY", "WORKSPACE", "PROJECT"]).default("ORGANIZATION"),
  scopeId: z.string().uuid().optional(),
});

/**
 * Invite someone with a role at a scope. The inviter must be able to grant that role right now
 * (users.manage + roles.assign + every permission in the role) — the same no-escalation rule as assignRole.
 * Returns the raw token for delivery by the email provider; only its hash is stored.
 */
export async function inviteMember(ctx: RequestContext, organizationId: string, raw: z.input<typeof inviteInput>) {
  requireUser(ctx);
  const input = inviteInput.parse(raw);
  const scopeId = input.scopeId ?? organizationId;
  const result = await transaction(async (tx) => {
    const chain = await chainFor(tx, { type: input.scopeType, id: scopeId }, organizationId);
    await requirePermission(ctx, "users.manage", chain, tx);
    await requirePermission(ctx, "roles.assign", chain, tx);
    const role = await tx.role.findUnique({ where: { id: input.roleId }, include: { permissions: { include: { permission: true } } } });
    if (!role || (role.organizationId && role.organizationId !== organizationId)) throw notFound("Role");
    if (!role.assignableAt.includes(input.scopeType) || isPlatformScope(input.scopeType)) {
      throw invalid(`Role ${role.key} cannot be assigned at ${input.scopeType} scope`);
    }
    for (const rp of role.permissions) {
      if (!(await can(ctx, rp.permission.key, chain, tx))) {
        throw forbidden(`Cannot invite with ${role.key}: you do not hold ${rp.permission.key}`);
      }
    }
    const token = randomToken(32);
    const invitation = await tx.invitation.create({
      data: {
        organizationId,
        email: input.email,
        roleId: role.id,
        scopeType: input.scopeType,
        scopeId,
        tokenHash: sha256(token),
        invitedById: ctx.actor.id!,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "member.invited",
      resourceType: "invitation",
      resourceId: invitation.id,
      newValue: { email: input.email, roleKey: role.key, scopeType: input.scopeType, scopeId },
    });
    await emitEvent(tx, ctx, "member.invited", { invitationId: invitation.id, organizationId, roleKey: role.key }, {
      organizationId,
      aggregateType: "invitation",
      aggregateId: invitation.id,
    });
    return { invitationId: invitation.id, token };
  });
  // Email delivery is behind the notifications provider abstraction (Phase 1.1); never log the token.
  logger.info({ invitationId: result.invitationId, organizationId }, "invitation created");
  return result;
}

/** Accept an invitation as the signed-in user whose email matches it. */
export async function acceptInvitation(ctx: RequestContext, token: string) {
  const userId = requireUser(ctx);
  return transaction(async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) throw notFound("Invitation");
    if (inv.email !== user.email) throw new AppError("forbidden", "This invitation was sent to a different email address");
    const existing = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: inv.organizationId, userId } } });
    if (existing) throw conflict("Already a member");
    await tx.membership.create({ data: { organizationId: inv.organizationId, userId } });
    const assignment = await tx.roleAssignment.create({
      data: {
        principalType: "USER",
        principalId: userId,
        roleId: inv.roleId,
        scopeType: inv.scopeType,
        scopeId: inv.scopeId,
        organizationId: inv.organizationId,
        grantedById: inv.invitedById,
      },
    });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId: inv.organizationId,
      action: "member.joined",
      resourceType: "membership",
      resourceId: assignment.id,
      newValue: { invitationId: inv.id, roleId: inv.roleId, scopeType: inv.scopeType, scopeId: inv.scopeId },
    });
    await emitEvent(tx, ctx, "member.joined", { organizationId: inv.organizationId, userId }, {
      organizationId: inv.organizationId,
      aggregateType: "membership",
      aggregateId: userId,
    });
    return { organizationId: inv.organizationId };
  });
}
