import { z } from "zod";
import { db, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { daysAgo, requireAnyPlatform } from "./access";

export const auditFilters = z.object({
  category: z.enum(["TENANT", "ADMIN", "SECURITY"]).optional().catch(undefined),
  action: z.string().trim().max(120).optional().catch(undefined),
  actor: z.string().trim().max(254).optional().catch(undefined),
  org: z.string().uuid().optional().catch(undefined),
  resource: z.string().trim().max(120).optional().catch(undefined),
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
    ],
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
