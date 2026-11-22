import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { conflict, notFound } from "@/server/core/errors";
import { sha256 } from "@/server/core/crypto";
import { writeAudit } from "@/server/modules/audit/service";
import { MFA_FRESHNESS_MS } from "@/server/modules/rbac/service";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "@/server/modules/auth/session";
import { LIMITS } from "@/server/core/limits";
import { daysAgo, isUuid, reasonSchema, requireAnyPlatform, requireConfirmation } from "./access";

export const auditFilters = z.object({
  category: z.enum(["TENANT", "ADMIN", "SECURITY"]).optional().catch(undefined),
  action: z.string().trim().max(120).optional().catch(undefined),
  actor: z.string().trim().max(254).optional().catch(undefined),
  org: z.string().uuid().optional().catch(undefined),
  resource: z.string().trim().max(120).optional().catch(undefined),
  /** Exact request id (links an action to every record it wrote). */
  requestId: z.string().trim().max(100).optional().catch(undefined),
  /** Free text over action, resource id and reason. */
  q: z.string().trim().max(200).optional().catch(undefined),
  from: z.coerce.date().optional().catch(undefined),
  to: z.coerce.date().optional().catch(undefined),
  scope: z.enum(["platform", "all"]).default("platform").catch("platform"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional().catch(undefined),
});
export type AuditFilters = Partial<Record<keyof z.input<typeof auditFilters>, unknown>>;

async function auditWhere(f: z.infer<typeof auditFilters>): Promise<Prisma.AuditLogWhereInput> {
  let actorIds: string[] | undefined;
  if (f.actor) {
    const users = await db().user.findMany({ where: { email: { contains: f.actor, mode: "insensitive" } }, select: { id: true }, take: 50 });
    actorIds = users.map((u) => u.id);
  }
  return {
    ...(f.category ? { category: f.category } : {}),
    ...(f.action ? { action: { contains: f.action } } : {}),
    ...(actorIds ? { actorId: { in: actorIds } } : {}),
    ...(f.org ? { organizationId: f.org } : {}),
    AND: [
      ...(!f.org && f.scope === "platform" ? [{ OR: [{ organizationId: null }, { category: { in: ["ADMIN", "SECURITY"] as ("ADMIN" | "SECURITY")[] } }] }] : []),
      ...(f.resource ? [{ OR: [{ resourceType: f.resource }, { resourceId: f.resource }] }] : []),
      ...(f.q ? [{ OR: [{ action: { contains: f.q, mode: "insensitive" as const } }, { resourceId: f.q }, { reason: { contains: f.q, mode: "insensitive" as const } }] }] : []),
    ],
    ...(f.requestId ? { requestId: f.requestId } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: new Date(f.to.getTime() + 86_399_999) } : {}) } } : {}),
  };
}

/** Platform audit trail with filters (actor email, action, category, organization, resource, time range). */
export async function searchAudit(ctx: RequestContext, raw: AuditFilters = {}) {
  await requirePermission(ctx, "platform.audit.read", platformChain());
  const f = auditFilters.parse(raw);
  const where = await auditWhere(f);
  const rows = await db().auditLog.findMany({ where, orderBy: { id: "desc" }, take: f.limit + 1, ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}) });
  const hasMore = rows.length > f.limit;
  const data = hasMore ? rows.slice(0, f.limit) : rows;
  const actors = await db().user.findMany({ where: { id: { in: [...new Set(data.map((a) => a.actorId).filter((x): x is string => !!x))] } }, select: { id: true, email: true } });
  return { data: data.map((a) => ({ ...a, actorEmail: actors.find((u) => u.id === a.actorId)?.email ?? null })), nextCursor: hasMore ? data[data.length - 1]!.id : null };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  // Neutralize spreadsheet formulas and quote every cell.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export const AUDIT_EXPORT_MAX = 10_000;

/** CSV export of the filtered audit trail (at most AUDIT_EXPORT_MAX rows, newest first). */
export async function exportAuditCsv(ctx: RequestContext, raw: AuditFilters = {}) {
  await requirePermission(ctx, "platform.audit.read", platformChain());
  const f = auditFilters.parse(raw);
  const rows = await db().auditLog.findMany({ where: await auditWhere(f), orderBy: { id: "desc" }, take: AUDIT_EXPORT_MAX });
  const actors = await db().user.findMany({ where: { id: { in: [...new Set(rows.map((a) => a.actorId).filter((x): x is string => !!x))] } }, select: { id: true, email: true } });
  const header = ["time", "category", "action", "actor_type", "actor_id", "actor_email", "organization_id", "resource_type", "resource_id", "reason", "ip", "request_id", "old_value", "new_value"];
  const lines = rows.map((a) =>
    [a.createdAt.toISOString(), a.category, a.action, a.actorType, a.actorId, actors.find((u) => u.id === a.actorId)?.email ?? "", a.organizationId, a.resourceType, a.resourceId, a.reason, a.ip, a.requestId, a.oldValue, a.newValue].map(csvCell).join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

const SECURITY_ACTIONS = ["auth.sign_in_failed", "auth.mfa_failed", "user.suspended", "user.deleted", "user.sessions_revoked", "role.assigned", "role.revoked", "api_key.revoked", "platform.lockdown.started", "platform.lockdown.ended", "platform.control.changed", "platform.bootstrap_admin"];

/** Security events (SECURITY audit category) of the last 30 days plus admin sessions and failed sign-ins. */
export async function securityOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.security.read", "platform.audit.read"]);
  const since = daysAgo(30);
  const [events, byAction, adminGrants] = await Promise.all([
    db().auditLog.findMany({ where: { category: "SECURITY", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db().auditLog.groupBy({ by: ["action"], where: { category: "SECURITY", createdAt: { gte: since } }, _count: { _all: true } }),
    db().roleAssignment.findMany({ where: { principalType: "USER", scopeType: { in: ["PLATFORM", "REGION", "COUNTRY"] } }, select: { principalId: true, scopeType: true, scopeId: true, role: { select: { key: true } } } }),
  ]);
  const adminIds = [...new Set(adminGrants.map((g) => g.principalId))];
  const [admins, sessions] = await Promise.all([
    db().user.findMany({ where: { id: { in: adminIds } }, select: { id: true, email: true, name: true, mfaEnabled: true, status: true } }),
    db().session.findMany({
      where: { userId: { in: adminIds }, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      take: 100,
      select: { id: true, userId: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, mfaVerifiedAt: true },
    }),
  ]);
  const emails = await db().user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))] } }, select: { id: true, email: true } });
  return {
    events: events.map((e) => ({ ...e, actorEmail: emails.find((u) => u.id === e.actorId)?.email ?? null })),
    byAction: byAction.map((b) => ({ action: b.action, count: b._count._all })).sort((a, b) => b.count - a.count),
    highlighted: SECURITY_ACTIONS,
    admins: admins.map((a) => ({ ...a, roles: adminGrants.filter((g) => g.principalId === a.id).map((g) => (g.scopeType === "PLATFORM" ? g.role.key : `${g.role.key}@${g.scopeType}:${g.scopeId}`)) })),
    adminSessions: sessions.map((s) => ({ ...s, email: admins.find((a) => a.id === s.userId)?.email ?? "" })),
  };
}

// ───────────── Audit entry detail and JSON export (stream F) ─────────────

/**
 * One audit record (read-only: audit records are append-only and never editable from the UI) with actor and
 * organization, and the other records written by the same request. old/new values are returned as stored, for the
 * before/after diff.
 */
export async function getAuditEntry(ctx: RequestContext, id: string) {
  await requirePermission(ctx, "platform.audit.read", platformChain());
  if (!isUuid(id)) throw notFound("Audit record");
  const entry = await db().auditLog.findUnique({ where: { id } });
  if (!entry) throw notFound("Audit record");
  const [actor, org, sameRequest] = await Promise.all([
    entry.actorId && entry.actorType === "USER" ? db().user.findUnique({ where: { id: entry.actorId }, select: { id: true, name: true, email: true } }) : null,
    entry.organizationId ? db().organization.findUnique({ where: { id: entry.organizationId }, select: { id: true, name: true } }) : null,
    entry.requestId ? db().auditLog.findMany({ where: { requestId: entry.requestId, id: { not: entry.id } }, orderBy: { id: "asc" }, take: 20, select: { id: true, action: true, resourceType: true, resourceId: true, createdAt: true } }) : [],
  ]);
  return { entry, actor, organization: org, sameRequest };
}

/** JSON export (same filters and cap as the CSV). */
export async function exportAuditJson(ctx: RequestContext, raw: AuditFilters = {}) {
  await requirePermission(ctx, "platform.audit.read", platformChain());
  const f = auditFilters.parse(raw);
  const rows = await db().auditLog.findMany({ where: await auditWhere(f), orderBy: { id: "desc" }, take: AUDIT_EXPORT_MAX });
  const actors = await db().user.findMany({ where: { id: { in: [...new Set(rows.map((a) => a.actorId).filter((x): x is string => !!x))] } }, select: { id: true, email: true } });
  return JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, truncated: rows.length === AUDIT_EXPORT_MAX, records: rows.map((a) => ({ ...a, actorEmail: actors.find((u) => u.id === a.actorId)?.email ?? null })) }, null, 2);
}

// ───────────── Security center v2: posture (stream F) ─────────────

const maskEmail = (e: string) => {
  const [user, domain] = e.split("@");
  return domain ? `${(user ?? "").slice(0, 2)}•••@${domain}` : "•••";
};
const maskIp = (ip: string) => (ip.includes(".") ? ip.split(".").slice(0, 2).join(".") + ".•.•" : ip.split(":").slice(0, 2).join(":") + ":•");

/**
 * Security posture computed from recorded data only (no scanning is performed): failed authentication by account
 * and IP, MFA coverage, admin activity, sessions, API key risk, OAuth problems, webhook security, configuration
 * risks and the authentication policy in force. Every item names its source.
 */
export async function securityPosture(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.security.read", "platform.audit.read"]);
  const now = new Date();
  const d1 = daysAgo(1);
  const d7 = daysAgo(7);
  const d14 = daysAgo(14);
  const [failed24h, failed7d, failedByDay, failedByAccount, failedByIp, mfaFailed7d, users, usersMfa, adminGrants, adminActivity, activeSessions, oldSessions, keys, oauth, oauthFailures, webhooks, rotated, secrets, orgPolicies, sso] = await Promise.all([
    db().auditLog.count({ where: { action: "auth.sign_in_failed", createdAt: { gte: d1 } } }),
    db().auditLog.count({ where: { action: "auth.sign_in_failed", createdAt: { gte: d7 } } }),
    db().$queryRaw<{ day: Date; n: bigint }[]>`SELECT date_trunc('day', created_at) AS day, count(*)::bigint AS n FROM audit_logs WHERE action = 'auth.sign_in_failed' AND created_at >= ${d14} GROUP BY 1 ORDER BY 1`,
    db().$queryRaw<{ email: string | null; n: bigint; last: Date }[]>`SELECT new_value->>'email' AS email, count(*)::bigint AS n, max(created_at) AS last FROM audit_logs WHERE action = 'auth.sign_in_failed' AND created_at >= ${d7} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    db().$queryRaw<{ ip: string | null; n: bigint; accounts: bigint }[]>`SELECT ip, count(*)::bigint AS n, count(DISTINCT new_value->>'email')::bigint AS accounts FROM audit_logs WHERE action = 'auth.sign_in_failed' AND created_at >= ${d7} AND ip IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    db().auditLog.count({ where: { action: "auth.mfa_failed", createdAt: { gte: d7 } } }),
    db().user.count({ where: { status: "ACTIVE" } }),
    db().user.count({ where: { status: "ACTIVE", mfaEnabled: true } }),
    db().roleAssignment.findMany({ where: { principalType: "USER", scopeType: { in: ["PLATFORM", "REGION", "COUNTRY"] } }, select: { principalId: true } }),
    db().auditLog.groupBy({ by: ["actorId"], where: { category: { in: ["ADMIN", "SECURITY"] }, actorType: "USER", createdAt: { gte: d7 } }, _count: { _all: true }, orderBy: { _count: { actorId: "desc" } }, take: 10 }),
    db().session.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    db().session.count({ where: { revokedAt: null, expiresAt: { gt: now }, createdAt: { lt: daysAgo(25) } } }),
    db().apiKey.findMany({ where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true, organizationId: true, name: true, prefix: true, lastUsedAt: true, expiresAt: true, createdAt: true }, take: 2000 }),
    db().integrationConnection.groupBy({ by: ["status"], _count: { _all: true } }),
    db().auditLog.count({ where: { action: { startsWith: "auth.oauth_" }, NOT: { action: "auth.oauth_linked" }, createdAt: { gte: d7 } } }),
    db().integrationWebhookSubscription.findMany({ where: { active: true }, select: { id: true, url: true, createdAt: true }, take: 2000 }),
    db().auditLog.findMany({ where: { action: "integration.webhook_secret_rotated" }, select: { resourceId: true }, distinct: ["resourceId"], take: 5000 }),
    db().platformSecret.findMany({ select: { key: true, updatedAt: true } }),
    db().enterpriseOrgSettings.groupBy({ by: ["requireMfa", "enforceSso"], _count: { _all: true } }).catch(() => [] as { requireMfa: boolean; enforceSso: boolean; _count: { _all: number } }[]),
    db().enterpriseSsoConnection.groupBy({ by: ["protocol", "enabled"], _count: { _all: true } }).catch(() => [] as { protocol: string; enabled: boolean; _count: { _all: number } }[]),
  ]);
  const adminIds = [...new Set(adminGrants.map((g) => g.principalId))];
  const [admins, adminSessions, actorNames] = await Promise.all([
    db().user.findMany({ where: { id: { in: adminIds } }, select: { id: true, mfaEnabled: true, status: true } }),
    db().session.count({ where: { userId: { in: adminIds }, revokedAt: null, expiresAt: { gt: now } } }),
    db().user.findMany({ where: { id: { in: adminActivity.map((a) => a.actorId).filter((x): x is string => !!x) } }, select: { id: true, name: true, email: true } }),
  ]);
  const activeAdmins = admins.filter((a) => a.status === "ACTIVE");
  const keyKeys = keys.map((k) => k.id);
  const meta = keyKeys.length ? await db().enterpriseApiKeyMeta.findMany({ where: { apiKeyId: { in: keyKeys } }, select: { apiKeyId: true, scopes: true } }) : [];
  const d30 = daysAgo(30);
  const d90 = daysAgo(90);
  const neverUsed = keys.filter((k) => !k.lastUsedAt && k.createdAt < d30);
  const stale = keys.filter((k) => k.lastUsedAt && k.lastUsedAt < d90);
  const noExpiry = keys.filter((k) => !k.expiresAt);
  const broad = keys.filter((k) => (meta.find((m) => m.apiKeyId === k.id)?.scopes ?? []).some((s) => s.endsWith(".manage") || s.endsWith(".delete")));
  const rotatedIds = new Set(rotated.map((r) => r.resourceId));
  const insecure = webhooks.filter((w) => w.url.startsWith("http://"));
  const neverRotated = webhooks.filter((w) => !rotatedIds.has(w.id) && w.createdAt < daysAgo(180));
  const oldSecrets = secrets.filter((s) => s.updatedAt < daysAgo(365));
  const conn = (s: string) => oauth.find((o) => o.status === s)?._count._all ?? 0;
  const production = process.env.NODE_ENV === "production";
  const config: { key: string; severity: "high" | "medium" | "low"; source: string }[] = [];
  if (production && process.env.REALY_DEV_RELAX_MFA === "true") config.push({ key: "relaxMfaInProduction", severity: "high", source: "env REALY_DEV_RELAX_MFA" });
  if (!process.env.SENTRY_DSN) config.push({ key: "noErrorTracking", severity: "low", source: "env SENTRY_DSN" });
  if (process.env.EMAIL_PROVIDER === "resend" && !process.env.EMAIL_WEBHOOK_SECRET_RESEND) config.push({ key: "noEmailWebhookSecret", severity: "low", source: "platform key EMAIL_WEBHOOK_SECRET_RESEND" });
  if (process.env.EMAIL_PROVIDER === "postmark" && !process.env.EMAIL_WEBHOOK_SECRET_POSTMARK) config.push({ key: "noEmailWebhookSecret", severity: "low", source: "platform key EMAIL_WEBHOOK_SECRET_POSTMARK" });
  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) config.push({ key: "noStripeWebhookSecret", severity: "medium", source: "platform key STRIPE_WEBHOOK_SECRET" });
  if (activeAdmins.some((a) => !a.mfaEnabled)) config.push({ key: "adminWithoutMfa", severity: "high", source: "users.mfa_enabled of platform role holders" });
  if (oldSecrets.length) config.push({ key: "oldPlatformKeys", severity: "low", source: "platform_secrets.updated_at" });
  const ipHash = (ip: string) => sha256(`ip:${ip}`).slice(0, 12);
  return {
    generatedAt: now,
    failedAuth: {
      last24h: failed24h,
      last7d: failed7d,
      mfaFailed7d,
      byDay: failedByDay.map((d) => ({ day: d.day.toISOString().slice(0, 10), count: Number(d.n) })),
      byAccount: failedByAccount.map((a) => ({ account: a.email ? maskEmail(a.email) : "—", count: Number(a.n), last: a.last })),
      byIp: failedByIp.map((i) => ({ ip: maskIp(i.ip ?? ""), ipHash: ipHash(i.ip ?? ""), count: Number(i.n), accounts: Number(i.accounts) })),
    },
    mfa: { users, usersWithMfa: usersMfa, admins: activeAdmins.length, adminsWithMfa: activeAdmins.filter((a) => a.mfaEnabled).length, orgsRequiringMfa: orgPolicies.filter((p) => p.requireMfa).reduce((n, p) => n + p._count._all, 0) },
    adminActivity: adminActivity.map((a) => ({ actorId: a.actorId, count: a._count._all, who: actorNames.find((u) => u.id === a.actorId) ?? null })),
    sessions: { active: activeSessions, admin: adminSessions, olderThan25d: oldSessions },
    apiKeys: { active: keys.length, neverUsed: neverUsed.length, stale: stale.length, noExpiry: noExpiry.length, broadScopes: broad.length, worst: [...neverUsed, ...stale].slice(0, 10).map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt })) },
    oauth: { errorConnections: conn("ERROR"), connected: conn("CONNECTED"), failures7d: oauthFailures },
    webhooks: { active: webhooks.length, insecureUrls: insecure.length, secretNeverRotated180d: neverRotated.length },
    sso: { connections: sso.map((s) => ({ protocol: s.protocol, enabled: s.enabled, count: s._count._all })), orgsEnforcingSso: orgPolicies.filter((p) => p.enforceSso).reduce((n, p) => n + p._count._all, 0) },
    platformKeys: { stored: secrets.length, olderThan1y: oldSecrets.map((s) => ({ key: s.key, updatedAt: s.updatedAt })) },
    configRisks: config,
    policy: {
      adminMfaRequired: true,
      mfaFreshnessHours: MFA_FRESHNESS_MS / 3_600_000,
      sessionAbsoluteDays: SESSION_ABSOLUTE_MS / 86_400_000,
      sessionIdleDays: SESSION_IDLE_MS / 86_400_000,
      signInLimits: [...LIMITS.signIn, ...LIMITS.mfaVerify, ...LIMITS.passwordResetRequest].map((r) => ({ rule: r.name, limit: r.limit, windowMinutes: r.windowMs / 60_000, sensitive: !!r.sensitive })),
    },
  };
}

export const REVOKE_ADMIN_SESSIONS_PHRASE = "REVOKE ADMIN SESSIONS";
export const revokeAdminSessionsInput = z.object({ reason: reasonSchema, confirm: z.string().max(100).optional() });

/** Revoke every active session of every platform admin except the caller's current one (typed confirmation). */
export async function revokeAllAdminSessions(ctx: RequestContext, raw: z.input<typeof revokeAdminSessionsInput>) {
  const input = revokeAdminSessionsInput.parse(raw);
  requireConfirmation(input.confirm, REVOKE_ADMIN_SESSIONS_PHRASE);
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.security.manage", platformChain(), tx);
    const grants = await tx.roleAssignment.findMany({ where: { principalType: "USER", scopeType: { in: ["PLATFORM", "REGION", "COUNTRY"] } }, select: { principalId: true } });
    const ids = [...new Set(grants.map((g) => g.principalId))];
    if (!ids.length) throw conflict("No platform admins found");
    const r = await tx.session.updateMany({ where: { userId: { in: ids }, revokedAt: null, expiresAt: { gt: new Date() }, ...(ctx.sessionId ? { NOT: { id: ctx.sessionId } } : {}) }, data: { revokedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.admin_sessions_revoked", resourceType: "session", resourceId: null, newValue: { revoked: r.count, admins: ids.length }, reason: input.reason });
    return { revoked: r.count };
  });
}
