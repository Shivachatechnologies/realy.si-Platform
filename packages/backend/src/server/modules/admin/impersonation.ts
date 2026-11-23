import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { userContext, type RequestContext } from "@/server/core/context";
import { randomToken, sha256 } from "@/server/core/crypto";
import { env } from "@/server/core/env";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { createSession } from "@/server/modules/auth/session";
import { loadGrants, requirePermission } from "@/server/modules/rbac/service";
import { isPlatformScope, platformChain } from "@/server/modules/rbac/scope";
import { isUuid, mfaCodeSchema, reasonSchema, recheckMfa, requireAnyPlatform, requireConfirmation } from "./access";
import { notifyAdmins } from "./notifications";

/**
 * Audited impersonation (Admin → Users → Impersonate), across both apps:
 *
 *   1. A SUPER_ADMIN holding `platform.impersonate` (MFA-gated, plus a fresh authenticator code) gives a reason and
 *      an optional ticket, picks a duration (≤ 60 min) and a mode. READ_ONLY is the default; FULL needs a second,
 *      explicit confirmation (the target's email typed). Platform administrators can never be impersonated.
 *   2. The admin app mints a one-time token (only its SHA-256 is stored, valid 2 minutes) and opens
 *      USER_APP_URL/<locale>/impersonate/<token>.
 *   3. The user app redeems it (apps/user/src/app/[locale]/impersonate/[token]/route.ts) into a Session row with
 *      impersonatorId / impersonationId that expires with the impersonation. A persistent banner shows who is
 *      impersonating, the mode and the remaining time, with an "End" action.
 *   4. rbac (service.ts restrictionReason) refuses every write permission of a READ_ONLY session, and every platform
 *      permission of any impersonation session. `impersonationRequestGate` refuses mutating HTTP requests of a
 *      READ_ONLY session for the route() wrapper, and `recordImpersonatedRequest` attributes each request to the
 *      admin in the audit log (both wired by stream E's request hooks).
 *   5. The session ends when the admin ends it (either app), when the target user is suspended or deleted (their
 *      sessions are revoked), when it is revoked by a security admin, or at expiry (sweepImpersonations).
 */

export const IMPERSONATION_MAX_MINUTES = 60;
export const IMPERSONATION_TOKEN_TTL_MS = 2 * 60_000;

export const startImpersonationInput = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
  ticketRef: z.string().trim().max(120).optional(),
  minutes: z.coerce.number().int().min(5).max(IMPERSONATION_MAX_MINUTES).default(30),
  mode: z.enum(["READ_ONLY", "FULL"]).default("READ_ONLY"),
  /** FULL mode only: the explicit second confirmation (the target's email, typed). */
  confirmWrite: z.string().max(254).optional(),
  organizationId: z.string().uuid().optional(),
  locale: z.string().max(10).optional(),
  mfaCode: mfaCodeSchema,
});

async function holdsActiveSuperAdmin(userId: string) {
  const grants = await loadGrants(db(), "USER", userId);
  return grants.some((g) => g.roleKey === "SUPER_ADMIN" && isPlatformScope(g.scopeType));
}

async function isPlatformAdministrator(userId: string) {
  const n = await db().roleAssignment.count({ where: { principalType: "USER", principalId: userId, scopeType: { in: ["PLATFORM", "REGION", "COUNTRY"] } } });
  return n > 0;
}

const userAppUrl = () => env().USER_APP_URL ?? env().APP_URL;

/** Start an impersonation and mint its one-time link. Returns the link once; it is never stored or logged. */
export async function startImpersonation(ctx: RequestContext, raw: z.input<typeof startImpersonationInput>) {
  const input = startImpersonationInput.parse(raw);
  await requirePermission(ctx, "platform.impersonate", platformChain());
  if (!(await holdsActiveSuperAdmin(ctx.actor.id!))) throw forbidden("Only super admins can impersonate users", { reason: "super_admin_only" });
  if (input.userId === ctx.actor.id) throw invalid("You cannot impersonate yourself");
  const target = await db().user.findUnique({ where: { id: input.userId }, select: { id: true, email: true, name: true, status: true, locale: true } });
  if (!target) throw notFound("User");
  if (target.status !== "ACTIVE") throw conflict("Only active accounts can be impersonated", { reason: "not_active" });
  if (await isPlatformAdministrator(target.id)) throw conflict("Platform administrators cannot be impersonated", { reason: "platform_admin" });
  if (input.mode === "FULL") requireConfirmation(input.confirmWrite, target.email);
  let organizationId: string | null = null;
  if (input.organizationId) {
    const m = await db().membership.findUnique({ where: { organizationId_userId: { organizationId: input.organizationId, userId: target.id } }, select: { status: true } });
    if (m?.status !== "ACTIVE") throw invalid("The user is not an active member of that organization", { field: "organizationId" });
    organizationId = input.organizationId;
  }
  await recheckMfa(ctx, input.mfaCode);

  const token = randomToken(32);
  const now = Date.now();
  const row = await transaction(async (tx) => {
    // One live impersonation per admin: starting a new one ends the previous one.
    const previous = await tx.adminImpersonation.findMany({ where: { adminUserId: ctx.actor.id!, endedAt: null, expiresAt: { gt: new Date(now) } }, select: { id: true, sessionId: true } });
    for (const p of previous) {
      await tx.adminImpersonation.update({ where: { id: p.id }, data: { endedAt: new Date(now), endedBy: "admin", tokenHash: null } });
      if (p.sessionId) await tx.session.updateMany({ where: { id: p.sessionId, revokedAt: null }, data: { revokedAt: new Date(now) } });
    }
    const created = await tx.adminImpersonation.create({
      data: {
        adminUserId: ctx.actor.id!,
        targetUserId: target.id,
        organizationId,
        mode: input.mode,
        reason: input.reason,
        ticketRef: input.ticketRef || null,
        tokenHash: sha256(token),
        tokenExpiresAt: new Date(now + IMPERSONATION_TOKEN_TTL_MS),
        expiresAt: new Date(now + input.minutes * 60_000),
      },
    });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "platform.impersonation.started",
      resourceType: "user",
      resourceId: target.id,
      newValue: { impersonationId: created.id, mode: input.mode, minutes: input.minutes, ticketRef: input.ticketRef ?? null, endedPrevious: previous.length },
      reason: input.reason,
    });
    return created;
  });
  await notifyTarget(target, row.id, organizationId).catch((err) => logger.warn({ err, impersonationId: row.id }, "impersonation notice not sent"));
  await notifyAdmins(ctx, { permission: "platform.security.read", type: "impersonation.started", severity: input.mode === "FULL" ? "WARNING" : "INFO", title: `Impersonation of ${target.email} (${input.mode})`, href: `/users/${target.id}`, dedupeKey: `impersonation:${row.id}` }).catch(() => undefined);
  const locale = input.locale && /^[a-z]{2}-[A-Z]{2}$/.test(input.locale) ? input.locale : target.locale;
  return { id: row.id, mode: row.mode, expiresAt: row.expiresAt, url: `${userAppUrl()}/${locale}/impersonate/${encodeURIComponent(token)}`, tokenExpiresAt: row.tokenExpiresAt };
}

const NOTICE: Record<string, { subject: string; body: string }> = {
  "en-US": { subject: "A Realy administrator accessed your account", body: "A Realy platform administrator started a time-boxed, audited support session on your account. Reference: {id}. If you did not expect this, contact support." },
  "de-DE": { subject: "Ein Realy-Administrator hat auf Ihr Konto zugegriffen", body: "Ein Realy-Plattformadministrator hat eine zeitlich begrenzte, protokollierte Support-Sitzung in Ihrem Konto gestartet. Referenz: {id}. Falls Sie das nicht erwartet haben, wenden Sie sich an den Support." },
  "ar-AE": { subject: "قام مسؤول في Realy بالوصول إلى حسابك", body: "بدأ أحد مسؤولي منصة Realy جلسة دعم محدودة المدة ومسجلة في حسابك. المرجع: {id}. إذا لم تكن تتوقع ذلك، فاتصل بالدعم." },
  "hi-IN": { subject: "Realy के एक व्यवस्थापक ने आपके खाते तक पहुँच की", body: "Realy प्लेटफ़ॉर्म के एक व्यवस्थापक ने आपके खाते पर समय-सीमित, ऑडिट किया गया सहायता सत्र शुरू किया। संदर्भ: {id}। यदि आपको इसकी अपेक्षा नहीं थी, तो सहायता से संपर्क करें।" },
  "zh-CN": { subject: "Realy 管理员访问了您的账户", body: "一位 Realy 平台管理员在您的账户上启动了一个有时限且经过审计的支持会话。参考编号：{id}。如果这不在您的预期之内，请联系支持团队。" },
};

/** Tell the target user (email, recorded in email_messages; skipped truthfully when the user has no organization). */
async function notifyTarget(target: { id: string; email: string; locale: string }, impersonationId: string, organizationId: string | null) {
  const orgId = organizationId ?? (await db().membership.findFirst({ where: { userId: target.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { organizationId: true } }))?.organizationId;
  if (!orgId) return { status: "SKIPPED" as const };
  const text = NOTICE[target.locale] ?? NOTICE["en-US"]!;
  const { sendPlainEmail } = await import("@/server/modules/email/service");
  return sendPlainEmail({ to: target.email, subject: text.subject, text: text.body.replace("{id}", impersonationId), template: "platform.impersonation_notice", organizationId: orgId, userId: target.id, locale: target.locale });
}

/**
 * User app: redeem a one-time token into an impersonation session. Returns the raw session token for the user-app
 * cookie, or throws `not_found` for any unusable token (unknown, used, expired, ended, target no longer active, or
 * the admin no longer a super admin with platform.impersonate).
 */
export async function redeemImpersonationToken(token: string, meta: { ip: string | null; userAgent: string | null; requestId?: string }) {
  if (!token || token.length > 128) throw notFound("Impersonation");
  const now = new Date();
  return transaction(async (tx) => {
    const imp = await tx.adminImpersonation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!imp || imp.redeemedAt || imp.endedAt || !imp.tokenExpiresAt || imp.tokenExpiresAt <= now || imp.expiresAt <= now) throw notFound("Impersonation");
    const target = await tx.user.findUnique({ where: { id: imp.targetUserId }, select: { status: true } });
    if (target?.status !== "ACTIVE") throw notFound("Impersonation");
    const adminGrants = await loadGrants(tx, "USER", imp.adminUserId);
    if (!adminGrants.some((g) => g.roleKey === "SUPER_ADMIN" && isPlatformScope(g.scopeType) && g.permissions.has("platform.impersonate"))) throw notFound("Impersonation");
    // No MFA on the impersonation session: MFA-gated tenant permissions (billing, roles, developer keys…) stay closed.
    const { token: sessionToken, session } = await createSession(tx, imp.targetUserId, { mfaPending: false, mfaVerifiedAt: null, ip: meta.ip, userAgent: meta.userAgent });
    await tx.session.update({ where: { id: session.id }, data: { expiresAt: imp.expiresAt, impersonatorId: imp.adminUserId, impersonationId: imp.id, activeOrganizationId: imp.organizationId } });
    await tx.adminImpersonation.update({ where: { id: imp.id }, data: { tokenHash: null, redeemedAt: now, sessionId: session.id } });
    const adminCtx = userContext(imp.adminUserId, { requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent, sessionId: session.id });
    await writeAudit(tx, adminCtx, { category: "SECURITY", organizationId: imp.organizationId, action: "platform.impersonation.redeemed", resourceType: "user", resourceId: imp.targetUserId, newValue: { impersonationId: imp.id, sessionId: session.id, mode: imp.mode } });
    return { sessionToken, expiresAt: imp.expiresAt, impersonationId: imp.id };
  });
}

async function endRow(id: string, by: "admin" | "target" | "expiry" | "revoked", actor: RequestContext, reason?: string) {
  return transaction(async (tx) => {
    const imp = await tx.adminImpersonation.findUnique({ where: { id } });
    if (!imp) throw notFound("Impersonation");
    if (imp.endedAt) return { id, endedAt: imp.endedAt, already: true };
    const endedAt = new Date();
    await tx.adminImpersonation.update({ where: { id }, data: { endedAt, endedBy: by, tokenHash: null } });
    const revoked = await tx.session.updateMany({ where: { impersonationId: id, revokedAt: null }, data: { revokedAt: endedAt } });
    await writeAudit(tx, actor, { category: "SECURITY", organizationId: imp.organizationId, action: "platform.impersonation.ended", resourceType: "user", resourceId: imp.targetUserId, newValue: { impersonationId: id, endedBy: by, revokedSessions: revoked.count, requests: imp.requestCount }, reason: reason ?? null });
    return { id, endedAt, already: false };
  });
}

export const endImpersonationInput = z.object({ reason: z.string().trim().max(500).optional() });

/** Admin app: end an impersonation. The impersonating admin may always end their own; others need platform.security.manage. */
export async function endImpersonation(ctx: RequestContext, impersonationId: string, raw: z.input<typeof endImpersonationInput> = {}) {
  const input = endImpersonationInput.parse(raw);
  if (!isUuid(impersonationId)) throw notFound("Impersonation");
  const imp = await db().adminImpersonation.findUnique({ where: { id: impersonationId }, select: { adminUserId: true } });
  if (!imp) throw notFound("Impersonation");
  if (imp.adminUserId === ctx.actor.id) {
    await requireAnyPlatform(ctx, ["platform.impersonate", "platform.security.manage"]);
    return endRow(impersonationId, "admin", ctx, input.reason);
  }
  await requirePermission(ctx, "platform.security.manage", platformChain());
  const reason = reasonSchema.parse(input.reason);
  return endRow(impersonationId, "revoked", ctx, reason);
}

/** User app ("End" in the banner): end the impersonation behind this session. Attributed to the impersonating admin. */
export async function endImpersonationForSession(sessionId: string, meta: { ip: string | null; userAgent: string | null; requestId?: string }) {
  if (!isUuid(sessionId)) return null;
  const s = await db().session.findUnique({ where: { id: sessionId }, select: { impersonationId: true, impersonatorId: true } });
  if (!s?.impersonationId || !s.impersonatorId) return null;
  return endRow(s.impersonationId, "admin", userContext(s.impersonatorId, { requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent, sessionId }));
}

/** Banner data for a user-app session (null when the session is not an impersonation, or it is over). */
export async function impersonationForSession(sessionId: string | null | undefined) {
  if (!sessionId || !isUuid(sessionId)) return null;
  const s = await db().session.findUnique({ where: { id: sessionId }, select: { impersonationId: true } });
  if (!s?.impersonationId) return null;
  const imp = await db().adminImpersonation.findUnique({ where: { id: s.impersonationId }, select: { id: true, adminUserId: true, targetUserId: true, mode: true, expiresAt: true, endedAt: true, ticketRef: true } });
  if (!imp) return null;
  const people = await db().user.findMany({ where: { id: { in: [imp.adminUserId, imp.targetUserId] } }, select: { id: true, name: true, email: true } });
  return {
    id: imp.id,
    mode: imp.mode,
    expiresAt: imp.expiresAt,
    live: !imp.endedAt && imp.expiresAt.getTime() > Date.now(),
    ticketRef: imp.ticketRef,
    admin: people.find((p) => p.id === imp.adminUserId) ?? null,
    target: people.find((p) => p.id === imp.targetUserId) ?? null,
  };
}

/** Paths a READ_ONLY impersonation session may still POST to (end it, sign out). */
const READ_ONLY_ALLOWED = [/^\/api\/v1\/auth\/sign-out$/, /^\/[a-z]{2}-[A-Z]{2}\/impersonate\/[^/]+\/end$/];
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Request gate for route() (stream E's pre-handler hook): a READ_ONLY impersonation session may not send mutating
 * requests, whatever the route — including self-service auth and profile endpoints that are not permission-checked.
 * Pass `impersonationId` when the caller already knows it (SessionInfo); `undefined` looks it up (one indexed read).
 */
export async function impersonationRequestGate(req: { sessionId: string | null; impersonationId?: string | null; method: string; pathname: string }) {
  if (!req.sessionId || !MUTATING.has(req.method.toUpperCase())) return;
  if (READ_ONLY_ALLOWED.some((r) => r.test(req.pathname))) return;
  let impersonationId = req.impersonationId;
  if (impersonationId === undefined) impersonationId = (await db().session.findUnique({ where: { id: req.sessionId }, select: { impersonationId: true } }))?.impersonationId ?? null;
  if (!impersonationId) return;
  const imp = await db().adminImpersonation.findUnique({ where: { id: impersonationId }, select: { mode: true, endedAt: true, expiresAt: true } });
  if (imp && imp.mode === "FULL" && !imp.endedAt && imp.expiresAt.getTime() > Date.now()) return;
  throw new AppError("forbidden", "This is a read-only impersonation session: changes are not allowed", { reason: "impersonation_read_only" });
}

/**
 * Attribute one request of an impersonation session to the impersonating admin (stream E's onRequestComplete hook):
 * an audit row `platform.impersonation.request` (actor = admin, with the request id, so tenant audit rows of the same
 * request can be joined) and the impersonation's request counter. No-op for normal sessions.
 */
export async function recordImpersonatedRequest(req: { sessionId: string | null; impersonationId?: string | null; method: string; route: string; status: number; requestId: string; ip: string | null; userAgent: string | null }) {
  if (!req.sessionId) return;
  let impersonationId = req.impersonationId;
  if (impersonationId === undefined) impersonationId = (await db().session.findUnique({ where: { id: req.sessionId }, select: { impersonationId: true } }))?.impersonationId ?? null;
  if (!impersonationId) return;
  const imp = await db().adminImpersonation.findUnique({ where: { id: impersonationId }, select: { id: true, adminUserId: true, targetUserId: true, organizationId: true, mode: true } });
  if (!imp) return;
  const ctx = userContext(imp.adminUserId, { requestId: req.requestId, ip: req.ip, userAgent: req.userAgent, sessionId: req.sessionId });
  await transaction(async (tx) => {
    await tx.adminImpersonation.update({ where: { id: imp.id }, data: { requestCount: { increment: 1 } } });
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId: imp.organizationId, action: "platform.impersonation.request", resourceType: "user", resourceId: imp.targetUserId, newValue: { impersonationId: imp.id, mode: imp.mode, method: req.method, route: req.route, status: req.status } });
  });
}

/** End impersonations past their expiry and revoke their sessions (people jobs). */
export async function sweepImpersonations(now = new Date()): Promise<number> {
  const due = await db().adminImpersonation.findMany({ where: { endedAt: null, expiresAt: { lte: now } }, take: 200, select: { id: true, adminUserId: true } });
  for (const d of due) await endRow(d.id, "expiry", userContext(d.adminUserId));
  return due.length;
}

const listInput = z.object({
  admin: z.string().uuid().optional().catch(undefined),
  target: z.string().uuid().optional().catch(undefined),
  state: z.enum(["live", "ended"]).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).default(50).catch(50),
  cursor: z.string().uuid().optional().catch(undefined),
});

/** Impersonation history (security readers, impersonators). Cursor-paginated, newest first. */
export async function listImpersonations(ctx: RequestContext, raw: Partial<Record<keyof z.input<typeof listInput>, unknown>> = {}) {
  const f = listInput.parse(raw);
  await requireAnyPlatform(ctx, ["platform.security.read", "platform.audit.read", "platform.impersonate"]);
  const now = new Date();
  const rows = await db().adminImpersonation.findMany({
    where: {
      ...(f.admin ? { adminUserId: f.admin } : {}),
      ...(f.target ? { targetUserId: f.target } : {}),
      ...(f.state === "live" ? { endedAt: null, expiresAt: { gt: now } } : f.state === "ended" ? { OR: [{ endedAt: { not: null } }, { expiresAt: { lte: now } }] } : {}),
    },
    orderBy: { id: "desc" },
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    select: { id: true, adminUserId: true, targetUserId: true, organizationId: true, mode: true, reason: true, ticketRef: true, startedAt: true, expiresAt: true, endedAt: true, endedBy: true, redeemedAt: true, requestCount: true },
  });
  const more = rows.length > f.limit;
  const page = more ? rows.slice(0, f.limit) : rows;
  const ids = [...new Set(page.flatMap((r) => [r.adminUserId, r.targetUserId]))];
  const people = ids.length ? await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  return {
    nextCursor: more ? page[page.length - 1]!.id : null,
    data: page.map((r) => ({ ...r, live: !r.endedAt && r.expiresAt > now, admin: people.find((p) => p.id === r.adminUserId) ?? null, target: people.find((p) => p.id === r.targetUserId) ?? null })),
  };
}
