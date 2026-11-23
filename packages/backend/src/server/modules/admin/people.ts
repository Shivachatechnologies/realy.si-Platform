import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { userContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { LOCALES } from "@/i18n/config";
import { requestPasswordReset } from "@/server/modules/auth/recovery";
import { writeAudit } from "@/server/modules/audit/service";
import { createOrganization } from "@/server/modules/organizations/service";
import { requirePermission, systemRoleId } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { daysAgo, isUuid, reasonSchema, requireAnyPlatform, requireConfirmation, utcMonthStart } from "./access";
import { aiUsageSince } from "./overview";

/**
 * People & tenants administration (Admin → Users / Organizations): profile edits, access reset (password reset email
 * + MFA re-enrolment), per-user usage/subscriptions and activity timeline, internal notes, organization create/edit,
 * members and roles, company activity. Every write is audited with the admin's reason.
 */

const tz = z.string().max(64).refine((v) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, "Unknown time zone");

// ───────────── Users ─────────────

export const userProfileInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  locale: z.enum(LOCALES).optional(),
  timezone: tz.optional(),
  reason: reasonSchema,
});

export async function updateUserProfile(ctx: RequestContext, userId: string, raw: z.input<typeof userProfileInput>) {
  const { reason, ...input } = userProfileInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    const u = await tx.user.findUnique({ where: { id: userId }, select: { name: true, email: true, locale: true, timezone: true } });
    if (!u) throw notFound("User");
    if (input.email && input.email !== u.email && (await tx.user.findUnique({ where: { email: input.email }, select: { id: true } }))) throw conflict("Another account already uses that email", { reason: "email_taken" });
    const emailChanged = !!input.email && input.email !== u.email;
    await tx.user.update({ where: { id: userId }, data: { ...input, ...(emailChanged ? { emailVerifiedAt: null } : {}) } });
    await writeAudit(tx, ctx, { category: emailChanged ? "SECURITY" : "ADMIN", action: "platform.user.profile_updated", resourceType: "user", resourceId: userId, oldValue: { name: u.name, email: u.email, locale: u.locale, timezone: u.timezone }, newValue: input, reason });
    return { id: userId, emailChanged };
  });
}

export const resetAccessInput = z.object({ reason: reasonSchema, resetMfa: z.boolean().default(true), sendPasswordReset: z.boolean().default(true) });

/**
 * Reset access: revoke every session, optionally remove MFA factors and recovery codes (the user must enrol again at
 * next sign-in) and send a password-reset email through the auth recovery flow.
 */
export async function resetUserAccess(ctx: RequestContext, userId: string, raw: z.input<typeof resetAccessInput>) {
  const input = resetAccessInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  if (userId === ctx.actor.id) throw conflict("Use your own security settings to reset your access");
  const result = await transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    const u = await tx.user.findUnique({ where: { id: userId }, select: { email: true, mfaEnabled: true } });
    if (!u) throw notFound("User");
    const sessions = await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (input.resetMfa) {
      await tx.mfaFactor.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.user.update({ where: { id: userId }, data: { mfaEnabled: false } });
    }
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.user.access_reset", resourceType: "user", resourceId: userId, newValue: { revokedSessions: sessions.count, mfaReset: input.resetMfa && u.mfaEnabled, passwordReset: input.sendPasswordReset }, reason: input.reason });
    return { email: u.email, revokedSessions: sessions.count };
  });
  const delivery = input.sendPasswordReset ? await requestPasswordReset(ctx, { email: result.email }) : null;
  return { revokedSessions: result.revokedSessions, mfaReset: input.resetMfa, emailDelivery: delivery?.emailDelivery ?? null };
}

export const singleResetInput = z.object({ reason: reasonSchema, confirm: z.string().max(254) });

/**
 * Secure MFA reset: removes every MFA factor and recovery code and revokes all sessions, so the user must sign in
 * again and re-enrol. Typed confirmation (the user's email) because it weakens the account until re-enrolment.
 */
export async function resetUserMfa(ctx: RequestContext, userId: string, raw: z.input<typeof singleResetInput>) {
  const input = singleResetInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  if (userId === ctx.actor.id) throw conflict("Use your own security settings to reset your MFA");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    const u = await tx.user.findUnique({ where: { id: userId }, select: { email: true, mfaEnabled: true, status: true } });
    if (!u) throw notFound("User");
    if (u.status === "DELETED") throw conflict("Deleted users cannot be changed");
    requireConfirmation(input.confirm, u.email);
    const [factors, codes] = await Promise.all([tx.mfaFactor.deleteMany({ where: { userId } }), tx.mfaRecoveryCode.deleteMany({ where: { userId } })]);
    const sessions = await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.user.update({ where: { id: userId }, data: { mfaEnabled: false } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.user.mfa_reset", resourceType: "user", resourceId: userId, oldValue: { mfaEnabled: u.mfaEnabled }, newValue: { factorsRemoved: factors.count, recoveryCodesRemoved: codes.count, revokedSessions: sessions.count }, reason: input.reason });
    return { factorsRemoved: factors.count, revokedSessions: sessions.count };
  });
}

export const passwordResetInput = z.object({ reason: reasonSchema });

/** Initiate a password reset: the standard reset email (auth recovery flow). Sessions are not touched. */
export async function sendUserPasswordReset(ctx: RequestContext, userId: string, raw: z.input<typeof passwordResetInput>) {
  const { reason } = passwordResetInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  const email = await transaction(async (tx) => {
    await requirePermission(ctx, "platform.users.manage", platformChain(), tx);
    const u = await tx.user.findUnique({ where: { id: userId }, select: { email: true, status: true } });
    if (!u) throw notFound("User");
    if (u.status !== "ACTIVE") throw conflict("Only active accounts can reset their password", { reason: "not_active" });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.user.password_reset_sent", resourceType: "user", resourceId: userId, reason });
    return u.email;
  });
  const delivery = await requestPasswordReset(ctx, { email });
  return { emailDelivery: delivery.emailDelivery };
}

/**
 * Authentication picture of one user: login methods, MFA factors (type and dates only, never secrets), recovery codes
 * left, sessions, failed sign-ins, password resets, other security events and impersonations of this account.
 */
export async function userAuthentication(ctx: RequestContext, userId: string) {
  await requireAnyPlatform(ctx, ["platform.users.read", "platform.support.read"]);
  if (!isUuid(userId)) throw notFound("User");
  const u = await db().user.findUnique({ where: { id: userId }, select: { email: true, passwordHash: true, mfaEnabled: true, emailVerifiedAt: true } });
  if (!u) throw notFound("User");
  const since = daysAgo(90);
  const [oauth, factors, codesLeft, sessions, failed, resets, verifications, events, impersonations] = await Promise.all([
    db().oAuthAccount.findMany({ where: { userId }, select: { provider: true, providerEmail: true, createdAt: true, lastLoginAt: true } }),
    db().mfaFactor.findMany({ where: { userId }, select: { id: true, type: true, confirmedAt: true, createdAt: true } }),
    db().mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
    db().session.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, mfaVerifiedAt: true, mfaPending: true, impersonationId: true } }),
    // Failed sign-ins are recorded against the account (resourceId) when the email matched one.
    db().auditLog.findMany({ where: { action: "auth.sign_in_failed", resourceType: "user", resourceId: userId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, ip: true, userAgent: true, createdAt: true } }),
    db().passwordResetToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, createdAt: true, expiresAt: true, usedAt: true } }),
    db().emailVerificationToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, createdAt: true, expiresAt: true, usedAt: true } }),
    db().auditLog.findMany({ where: { category: "SECURITY", resourceType: { in: ["user", "session"] }, OR: [{ resourceId: userId }, { actorId: userId }], action: { not: "auth.sign_in_failed" } }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, action: true, actorId: true, ip: true, reason: true, createdAt: true } }),
    db().adminImpersonation.findMany({ where: { targetUserId: userId }, orderBy: { startedAt: "desc" }, take: 20, select: { id: true, adminUserId: true, mode: true, reason: true, ticketRef: true, startedAt: true, expiresAt: true, endedAt: true, endedBy: true, redeemedAt: true } }),
  ]);
  const now = Date.now();
  const failed24h = failed.filter((f) => now - f.createdAt.getTime() < 86_400_000).length;
  const ids = [...new Set([...events.map((e) => e.actorId), ...impersonations.map((i) => i.adminUserId)].filter((x): x is string => !!x && x !== userId))];
  const people = ids.length ? await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const who = (id: string | null) => (id === userId ? null : (people.find((p) => p.id === id) ?? null));
  return {
    methods: { password: !!u.passwordHash, oauth },
    mfa: { enabled: u.mfaEnabled, factors, recoveryCodesLeft: codesLeft },
    emailVerifiedAt: u.emailVerifiedAt,
    sessions: sessions.map((s) => ({ ...s, active: !s.revokedAt && s.expiresAt.getTime() > now })),
    failedLogins: { items: failed, last24h: failed24h, last90d: failed.length, capped: failed.length >= 50 },
    passwordResets: resets.map((r) => ({ ...r, state: r.usedAt ? "used" : r.expiresAt.getTime() < now ? "expired" : "pending" })),
    verifications: verifications.map((r) => ({ ...r, state: r.usedAt ? "used" : r.expiresAt.getTime() < now ? "expired" : "pending" })),
    events: events.map((e) => ({ ...e, actor: who(e.actorId) })),
    impersonations: impersonations.map((i) => ({ ...i, admin: who(i.adminUserId), live: !i.endedAt && i.expiresAt.getTime() > now })),
  };
}

export const addMembershipInput = z.object({
  organization: z.string().trim().min(1).max(120),
  roleKey: z.enum(["ORGANIZATION_OWNER", "ORGANIZATION_ADMIN", "MEMBER"]),
  reason: reasonSchema,
});

/** Add a user to an organization (by id or slug) from the user page; same rules and audit as the members editor. */
export async function adminAddUserMembership(ctx: RequestContext, userId: string, raw: z.input<typeof addMembershipInput>) {
  const input = addMembershipInput.parse(raw);
  if (!isUuid(userId)) throw notFound("User");
  const [user, org] = await Promise.all([
    db().user.findUnique({ where: { id: userId }, select: { email: true } }),
    db().organization.findFirst({ where: isUuid(input.organization) ? { id: input.organization } : { slug: input.organization.toLowerCase() }, select: { id: true, status: true } }),
  ]);
  if (!user) throw notFound("User");
  if (!org) throw notFound("Organization");
  if (org.status === "CLOSED") throw conflict("The organization is archived", { reason: "organization_closed" });
  return { organizationId: org.id, ...(await adminAddMember(ctx, org.id, { email: user.email, roleKey: input.roleKey, reason: input.reason })) };
}

/** Usage, subscriptions (of organizations the user owns or belongs to) and an activity timeline for one user. */
export async function userInsights(ctx: RequestContext, userId: string) {
  await requireAnyPlatform(ctx, ["platform.users.read", "platform.support.read"]);
  if (!isUuid(userId)) throw notFound("User");
  const memberships = await db().membership.findMany({ where: { userId }, select: { organizationId: true, organization: { select: { name: true } } } });
  const orgIds = memberships.map((m) => m.organizationId);
  const [subs, tasksMonth, tasks30, activity, sessions, logins] = await Promise.all([
    db().subscription.findMany({ where: { organizationId: { in: orgIds } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, organizationId: true, status: true, interval: true, currency: true, currentPeriodEnd: true, plan: { select: { name: true } }, items: { select: { quantity: true, unitAmountMinor: true } } } }),
    db().agentTask.count({ where: { createdById: userId, createdAt: { gte: utcMonthStart() } } }),
    db().agentTask.groupBy({ by: ["model"], where: { createdById: userId, startedAt: { gte: daysAgo(30) } }, _sum: { inputTokens: true, outputTokens: true }, _count: { _all: true } }),
    db().auditLog.findMany({ where: { OR: [{ actorId: userId }, { resourceType: "user", resourceId: userId }] }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, category: true, action: true, actorId: true, organizationId: true, reason: true, createdAt: true } }),
    db().session.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, revokedAt: true, expiresAt: true, mfaVerifiedAt: true } }),
    db().auditLog.findMany({ where: { actorId: userId, action: { in: ["auth.mfa_verified", "auth.sign_in_failed", "auth.password_reset", "auth.mfa_enabled"] } }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, action: true, createdAt: true } }),
  ]);
  const actorIds = [...new Set(activity.map((a) => a.actorId).filter((x): x is string => !!x && x !== userId))];
  const actors = await db().user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  return {
    organizations: memberships.map((m) => ({ id: m.organizationId, name: m.organization.name })),
    subscriptions: subs.map((s) => ({ ...s, organizationName: memberships.find((m) => m.organizationId === s.organizationId)?.organization.name ?? "" })),
    ai: { tasksMonth, tokens30d: tasks30.reduce((a, r) => a + (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0), 0), tasks30d: tasks30.reduce((a, r) => a + r._count._all, 0) },
    activity: activity.map((a) => ({ ...a, actorName: a.actorId === userId ? null : (actors.find((x) => x.id === a.actorId)?.name ?? null) })),
    sessions,
    logins,
  };
}

// ───────────── Internal notes ─────────────

const TARGETS = { user: "USER", organization: "ORGANIZATION" } as const;
export const noteInput = z.object({ body: z.string().trim().min(1).max(4000), pinned: z.boolean().default(false) });

async function targetExists(type: "USER" | "ORGANIZATION", id: string) {
  return type === "USER" ? !!(await db().user.findUnique({ where: { id }, select: { id: true } })) : !!(await db().organization.findUnique({ where: { id }, select: { id: true } }));
}

export async function listNotes(ctx: RequestContext, target: keyof typeof TARGETS, targetId: string) {
  await requireAnyPlatform(ctx, ["platform.support.read", "platform.users.read", "platform.organizations.read"]);
  if (!isUuid(targetId)) throw notFound("Notes");
  const notes = await db().adminNote.findMany({ where: { targetType: TARGETS[target], targetId }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 100 });
  const authors = await db().user.findMany({ where: { id: { in: [...new Set(notes.map((n) => n.authorId))] } }, select: { id: true, name: true } });
  return notes.map((n) => ({ ...n, author: authors.find((a) => a.id === n.authorId)?.name ?? "—" }));
}

export async function addNote(ctx: RequestContext, target: keyof typeof TARGETS, targetId: string, raw: z.input<typeof noteInput>) {
  const input = noteInput.parse(raw);
  if (!isUuid(targetId) || !(target in TARGETS)) throw notFound("Notes");
  await requireAnyPlatform(ctx, ["platform.support.manage", "platform.users.manage", "platform.organizations.manage"]);
  const type = TARGETS[target];
  if (!(await targetExists(type, targetId))) throw notFound(target === "user" ? "User" : "Organization");
  return transaction(async (tx) => {
    const n = await tx.adminNote.create({ data: { targetType: type, targetId, body: input.body, pinned: input.pinned, authorId: ctx.actor.id! } });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: type === "ORGANIZATION" ? targetId : null, action: "platform.note_added", resourceType: target, resourceId: targetId, newValue: { noteId: n.id, pinned: input.pinned } });
    return { id: n.id };
  });
}

export async function deleteNote(ctx: RequestContext, noteId: string) {
  if (!isUuid(noteId)) throw notFound("Note");
  await requireAnyPlatform(ctx, ["platform.support.manage", "platform.users.manage", "platform.organizations.manage"]);
  return transaction(async (tx) => {
    const n = await tx.adminNote.findUnique({ where: { id: noteId } });
    if (!n) throw notFound("Note");
    await tx.adminNote.delete({ where: { id: noteId } });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: n.targetType === "ORGANIZATION" ? n.targetId : null, action: "platform.note_deleted", resourceType: n.targetType.toLowerCase(), resourceId: n.targetId, oldValue: { noteId, body: n.body.slice(0, 200) } });
    return { ok: true };
  });
}

// ───────────── Organizations ─────────────

export const createOrgInput = z.object({ name: z.string().trim().min(1).max(120), ownerEmail: z.string().trim().toLowerCase().email().max(254), defaultLocale: z.enum(LOCALES).default("en-US"), reason: reasonSchema });

/** Create an organization on behalf of an existing user, who becomes its owner (organizations service). */
export async function adminCreateOrganization(ctx: RequestContext, raw: z.input<typeof createOrgInput>) {
  const input = createOrgInput.parse(raw);
  await requirePermission(ctx, "platform.organizations.manage", platformChain());
  const owner = await db().user.findUnique({ where: { email: input.ownerEmail }, select: { id: true, status: true } });
  if (!owner) throw notFound("User");
  if (owner.status !== "ACTIVE") throw conflict("The owner's account is not active");
  const org = await createOrganization(userContext(owner.id, { requestId: ctx.requestId }), { name: input.name, defaultLocale: input.defaultLocale });
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", organizationId: org.id, action: "platform.organization.created", resourceType: "organization", resourceId: org.id, newValue: { name: org.name, slug: org.slug, ownerId: owner.id }, reason: input.reason }));
  return { id: org.id, slug: org.slug };
}

export const editOrgInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/)
    .optional(),
  defaultLocale: z.enum(LOCALES).optional(),
  reason: reasonSchema,
});

export async function adminEditOrganization(ctx: RequestContext, organizationId: string, raw: z.input<typeof editOrgInput>) {
  const { reason, ...input } = editOrgInput.parse(raw);
  if (!isUuid(organizationId)) throw notFound("Organization");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.organizations.manage", platformChain(), tx);
    const o = await tx.organization.findUnique({ where: { id: organizationId }, select: { name: true, slug: true, defaultLocale: true } });
    if (!o) throw notFound("Organization");
    if (input.slug && input.slug !== o.slug && (await tx.organization.findUnique({ where: { slug: input.slug }, select: { id: true } }))) throw conflict("That slug is taken", { reason: "slug_taken" });
    await tx.organization.update({ where: { id: organizationId }, data: input });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId, action: "platform.organization.updated", resourceType: "organization", resourceId: organizationId, oldValue: o, newValue: input, reason });
    return { id: organizationId };
  });
}

export const ORG_ROLE_KEYS = ["ORGANIZATION_OWNER", "ORGANIZATION_ADMIN", "MEMBER"] as const;
export const memberInput = z.object({ email: z.string().trim().toLowerCase().email().max(254), roleKey: z.enum(ORG_ROLE_KEYS), reason: reasonSchema });
export const memberRoleInput = z.object({ roleKey: z.enum(ORG_ROLE_KEYS), reason: reasonSchema });
export const memberRemoveInput = z.object({ reason: reasonSchema });

async function setOrgRole(tx: Parameters<Parameters<typeof transaction>[0]>[0], ctx: RequestContext, organizationId: string, userId: string, roleKey: (typeof ORG_ROLE_KEYS)[number]) {
  const roleIds = await Promise.all(ORG_ROLE_KEYS.map((k) => systemRoleId(tx, k)));
  const before = await tx.roleAssignment.findMany({ where: { organizationId, principalType: "USER", principalId: userId, scopeType: "ORGANIZATION", roleId: { in: roleIds } }, select: { id: true, role: { select: { key: true } } } });
  await tx.roleAssignment.deleteMany({ where: { id: { in: before.map((b) => b.id) } } });
  await tx.roleAssignment.create({ data: { principalType: "USER", principalId: userId, roleId: roleIds[ORG_ROLE_KEYS.indexOf(roleKey)]!, scopeType: "ORGANIZATION", scopeId: organizationId, organizationId, grantedById: ctx.actor.id } });
  return before.map((b) => b.role.key);
}

async function ensureAnotherOwner(tx: Parameters<Parameters<typeof transaction>[0]>[0], organizationId: string, userId: string) {
  const ownerRole = await systemRoleId(tx, "ORGANIZATION_OWNER");
  const others = await tx.roleAssignment.count({ where: { organizationId, roleId: ownerRole, scopeType: "ORGANIZATION", principalType: "USER", principalId: { not: userId } } });
  if (others === 0) throw conflict("An organization must keep at least one owner", { reason: "last_owner" });
}

/** Add an existing user as a member with an organization role (owner / admin / member). */
export async function adminAddMember(ctx: RequestContext, organizationId: string, raw: z.input<typeof memberInput>) {
  const input = memberInput.parse(raw);
  if (!isUuid(organizationId)) throw notFound("Organization");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.organizations.manage", platformChain(), tx);
    if (!(await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) throw notFound("Organization");
    const user = await tx.user.findUnique({ where: { email: input.email }, select: { id: true, status: true } });
    if (!user) throw notFound("User");
    if (user.status !== "ACTIVE") throw conflict("Only active users can be added");
    await tx.membership.upsert({ where: { organizationId_userId: { organizationId, userId: user.id } }, create: { organizationId, userId: user.id }, update: { status: "ACTIVE" } });
    const before = await setOrgRole(tx, ctx, organizationId, user.id, input.roleKey);
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId, action: "platform.organization.member_added", resourceType: "user", resourceId: user.id, oldValue: { roles: before }, newValue: { roleKey: input.roleKey }, reason: input.reason });
    return { userId: user.id };
  });
}

export async function adminSetMemberRole(ctx: RequestContext, organizationId: string, userId: string, raw: z.input<typeof memberRoleInput>) {
  const input = memberRoleInput.parse(raw);
  if (!isUuid(organizationId) || !isUuid(userId)) throw notFound("Member");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.organizations.manage", platformChain(), tx);
    const m = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { status: true } });
    if (!m) throw notFound("Member");
    if (input.roleKey !== "ORGANIZATION_OWNER") await ensureAnotherOwner(tx, organizationId, userId);
    const before = await setOrgRole(tx, ctx, organizationId, userId, input.roleKey);
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId, action: "platform.organization.member_role_changed", resourceType: "user", resourceId: userId, oldValue: { roles: before }, newValue: { roleKey: input.roleKey }, reason: input.reason });
    return { userId, roleKey: input.roleKey };
  });
}

export async function adminRemoveMember(ctx: RequestContext, organizationId: string, userId: string, raw: z.input<typeof memberRemoveInput>) {
  const { reason } = memberRemoveInput.parse(raw);
  if (!isUuid(organizationId) || !isUuid(userId)) throw notFound("Member");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.organizations.manage", platformChain(), tx);
    const m = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { status: true } });
    if (!m) throw notFound("Member");
    await ensureAnotherOwner(tx, organizationId, userId);
    const removed = await tx.roleAssignment.deleteMany({ where: { organizationId, principalType: "USER", principalId: userId } });
    await tx.membership.delete({ where: { organizationId_userId: { organizationId, userId } } });
    await tx.session.updateMany({ where: { userId, activeOrganizationId: organizationId, revokedAt: null }, data: { activeOrganizationId: null } });
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId, action: "platform.organization.member_removed", resourceType: "user", resourceId: userId, newValue: { removedAssignments: removed.count }, reason });
    return { userId };
  });
}

/** Company activity: audit trail of one organization (optionally one company), plus AI usage and module counts. */
export async function organizationActivity(ctx: RequestContext, organizationId: string, raw: { company?: string; category?: string } = {}) {
  await requireAnyPlatform(ctx, ["platform.organizations.read", "platform.support.read"]);
  if (!isUuid(organizationId)) throw notFound("Organization");
  const company = raw.company && isUuid(raw.company) ? raw.company : undefined;
  const category = raw.category === "TENANT" || raw.category === "ADMIN" || raw.category === "SECURITY" ? raw.category : undefined;
  const [org, companies, audit, tasks, ai30] = await Promise.all([
    db().organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } }),
    db().company.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    db().auditLog.findMany({ where: { organizationId, ...(category ? { category } : {}), ...(company ? { newValue: { path: ["companyId"], equals: company } } : {}) }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, category: true, action: true, actorType: true, actorId: true, resourceType: true, resourceId: true, reason: true, createdAt: true } }),
    db().agentTask.findMany({ where: { organizationId, ...(company ? { companyId: company } : {}) }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, title: true, status: true, profile: true, createdAt: true, companyId: true } }),
    aiUsageSince(daysAgo(30), { organizationId }),
  ]);
  if (!org) throw notFound("Organization");
  const actors = await db().user.findMany({ where: { id: { in: [...new Set(audit.map((a) => a.actorId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  return { org, companies, audit: audit.map((a) => ({ ...a, actorName: actors.find((x) => x.id === a.actorId)?.name ?? a.actorType })), tasks, ai30 };
}

/** Members with their organization roles, for the members editor. */
/** Upper bound of members listed in one admin view (B35); larger organizations are searched in Users. */
const MEMBER_CAP = 1000;

export async function organizationMembers(ctx: RequestContext, organizationId: string) {
  await requireAnyPlatform(ctx, ["platform.organizations.read", "platform.support.read"]);
  if (!isUuid(organizationId)) throw notFound("Organization");
  const [members, grants] = await Promise.all([
    db().membership.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: MEMBER_CAP, select: { status: true, createdAt: true, user: { select: { id: true, name: true, email: true, status: true, mfaEnabled: true } } } }),
    db().roleAssignment.findMany({ where: { organizationId, principalType: "USER" }, take: MEMBER_CAP * 10, select: { principalId: true, scopeType: true, role: { select: { key: true } } } }),
  ]);
  if (!members.length && !(await db().organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) throw invalid("Unknown organization");
  return members.map((m) => ({ ...m, roles: [...new Set(grants.filter((g) => g.principalId === m.user.id).map((g) => g.role.key))] }));
}
