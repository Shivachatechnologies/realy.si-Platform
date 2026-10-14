import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import { userContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { randomToken, sha256 } from "@/server/core/crypto";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { sendEmail } from "@/server/modules/email/service";
import { tokenLink } from "@/server/modules/auth/recovery";
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
 * The no-escalation rule for invitations: the granter must hold users.manage + roles.assign at the
 * scope and every permission in the role. Used at creation, resend and — with the inviter's *current*
 * grants — again at acceptance, so revoking an inviter also neutralizes their pending invitations.
 */
async function assertCanInvite(tx: Tx, granter: RequestContext, organizationId: string, roleId: string, scopeType: string, scopeId: string) {
  const chain = await chainFor(tx, { type: scopeType as "ORGANIZATION", id: scopeId }, organizationId);
  await requirePermission(granter, "users.manage", chain, tx);
  await requirePermission(granter, "roles.assign", chain, tx);
  const role = await tx.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
  if (!role || (role.organizationId && role.organizationId !== organizationId)) throw notFound("Role");
  if (!role.assignableAt.includes(scopeType as "ORGANIZATION") || isPlatformScope(scopeType as "ORGANIZATION")) {
    throw invalid(`Role ${role.key} cannot be assigned at ${scopeType} scope`);
  }
  for (const rp of role.permissions) {
    if (!(await can(granter, rp.permission.key, chain, tx))) {
      throw forbidden(`Cannot invite with ${role.key}: you do not hold ${rp.permission.key}`);
    }
  }
  return role;
}

/**
 * Invite someone with a role at a scope. Returns the raw token for delivery by email; only its hash is
 * stored, and the token is never logged or returned to the inviter by the API.
 */
export async function inviteMember(ctx: RequestContext, organizationId: string, raw: z.input<typeof inviteInput>) {
  requireUser(ctx);
  const input = inviteInput.parse(raw);
  const scopeId = input.scopeId ?? organizationId;
  return transaction(async (tx) => {
    const role = await assertCanInvite(tx, ctx, organizationId, input.roleId, input.scopeType, scopeId);
    const alreadyMember = await tx.membership.findFirst({ where: { organizationId, user: { email: input.email } } });
    if (alreadyMember) throw conflict("This person is already a member");
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
}

/** Email the invitation link and record the truthful delivery status on the invitation. */
export async function deliverInvitation(ctx: RequestContext, invitationId: string, token: string, locale: string) {
  const inv = await db().invitation.findUniqueOrThrow({ where: { id: invitationId }, include: { organization: true, role: true } });
  const inviter = await db().user.findUnique({ where: { id: inv.invitedById }, select: { name: true } });
  const result = await sendEmail({
    to: inv.email,
    template: "invitation",
    locale,
    vars: { inviter: inviter?.name ?? "", organization: inv.organization.name, role: inv.role.name },
    link: tokenLink(locale, "/invite", token),
    organizationId: inv.organizationId,
  });
  await db().invitation.update({
    where: { id: invitationId },
    data: { deliveryStatus: result.status, lastSentAt: new Date(), sendCount: { increment: 1 } },
  });
  logger.info({ invitationId, organizationId: inv.organizationId, delivery: result.status }, "invitation delivery");
  return result.status;
}

/** Pending (not accepted, not revoked, not expired) invitations. */
export async function listInvitations(ctx: RequestContext, organizationId: string) {
  await requirePermission(ctx, "users.read", orgChain(organizationId));
  return db().invitation.findMany({
    where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, scopeType: true, scopeId: true, expiresAt: true, deliveryStatus: true, lastSentAt: true, sendCount: true, role: { select: { key: true, name: true } } },
  });
}

async function pendingInvitation(tx: Tx, organizationId: string, invitationId: string) {
  const inv = await tx.invitation.findFirst({ where: { id: invitationId, organizationId, acceptedAt: null, revokedAt: null } });
  if (!inv) throw notFound("Invitation");
  return inv;
}

export async function revokeInvitation(ctx: RequestContext, organizationId: string, invitationId: string) {
  await transaction(async (tx) => {
    const inv = await pendingInvitation(tx, organizationId, invitationId);
    const chain = await chainFor(tx, { type: inv.scopeType, id: inv.scopeId }, organizationId);
    await requirePermission(ctx, "users.manage", chain, tx);
    await tx.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId, action: "member.invitation_revoked", resourceType: "invitation", resourceId: inv.id });
  });
}

/** Resend with a fresh token (the old link stops working) and a renewed expiry. */
export async function resendInvitation(ctx: RequestContext, organizationId: string, invitationId: string, locale: string) {
  const token = randomToken(32);
  await transaction(async (tx) => {
    const inv = await pendingInvitation(tx, organizationId, invitationId);
    await assertCanInvite(tx, ctx, organizationId, inv.roleId, inv.scopeType, inv.scopeId);
    await tx.invitation.update({ where: { id: inv.id }, data: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITATION_TTL_MS) } });
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId, action: "member.invitation_resent", resourceType: "invitation", resourceId: inv.id });
  });
  return deliverInvitation(ctx, invitationId, token, locale);
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

    // Re-validate the inviter's authority *now* (MFA freshness is about the inviter's session, not authority).
    const inviterCtx = userContext(inv.invitedById, { requestId: ctx.requestId, mfaVerifiedAt: new Date() });
    try {
      await assertCanInvite(tx, inviterCtx, inv.organizationId, inv.roleId, inv.scopeType, inv.scopeId);
    } catch {
      await tx.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
      await writeAudit(tx, ctx, { category: "SECURITY", organizationId: inv.organizationId, action: "member.invitation_invalidated", resourceType: "invitation", resourceId: inv.id, reason: "inviter no longer authorized" });
      return { organizationId: null as string | null, invalidated: true };
    }

    // Accepting proves the invitee controls the address the token was emailed to.
    if (!user.emailVerifiedAt) await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
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
    return { organizationId: inv.organizationId as string | null, invalidated: false };
  }).then((r) => {
    if (r.invalidated) throw notFound("Invitation");
    return { organizationId: r.organizationId! };
  });
}
