import { BlockList, isIP } from "node:net";
import { z } from "zod";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { orgChain, type ScopeChain } from "@/server/modules/rbac/scope";

/**
 * Organization policy: usage limits, security controls (MFA requirement, session timeout, IP allowlist) and retention.
 * `getOrgLimits` and `assertOrgAccess` are the cross-module entry points.
 */

export const DEFAULT_SETTINGS = {
  maxMembers: null as number | null,
  maxCompanies: null as number | null,
  maxWorkspacesPerCompany: null as number | null,
  maxAiTokensPerDay: null as number | null,
  maxApiKeys: null as number | null,
  requireMfa: false,
  sessionTimeoutMinutes: null as number | null,
  ipAllowlist: [] as string[],
  enforceSso: false,
  auditRetentionDays: null as number | null,
  dataRetentionDays: null as number | null,
};
export type OrgSettings = typeof DEFAULT_SETTINGS;

export async function getOrgSettings(organizationId: string, client: Tx | Db = db()): Promise<OrgSettings> {
  const row = await client.enterpriseOrgSettings.findUnique({
    where: { organizationId },
  });
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    maxMembers: row.maxMembers,
    maxCompanies: row.maxCompanies,
    maxWorkspacesPerCompany: row.maxWorkspacesPerCompany,
    maxAiTokensPerDay: row.maxAiTokensPerDay,
    maxApiKeys: row.maxApiKeys,
    requireMfa: row.requireMfa,
    sessionTimeoutMinutes: row.sessionTimeoutMinutes,
    ipAllowlist: row.ipAllowlist,
    enforceSso: row.enforceSso,
    auditRetentionDays: row.auditRetentionDays,
    dataRetentionDays: row.dataRetentionDays,
  };
}

async function saveSettings(tx: Tx, ctx: RequestContext, organizationId: string, patch: Partial<OrgSettings>, action: string) {
  const before = await getOrgSettings(organizationId, tx);
  await tx.enterpriseOrgSettings.upsert({
    where: { organizationId },
    create: { organizationId, ...patch },
    update: patch,
  });
  await writeAudit(tx, ctx, {
    category: "SECURITY",
    organizationId,
    action,
    resourceType: "organization_settings",
    resourceId: organizationId,
    oldValue: before,
    newValue: patch,
  });
}

// ───────────── Limits ─────────────

export interface OrgLimits {
  maxMembers: number | null;
  maxCompanies: number | null;
  maxWorkspacesPerCompany: number | null;
  maxAiTokensPerDay: number | null;
  maxApiKeys: number | null;
  /** Plan entitlement values (subscription), for display. */
  plan: {
    name: string | null;
    companiesMax: number | null;
    agentsMax: number | null;
  };
}

const minNullable = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));

/**
 * Effective limits of an organization (null = unlimited): the stricter of the organization's own configuration and its
 * plan entitlements (`companies.max`). Readable by every module; enforcement lives with the action being limited.
 */
export async function getOrgLimits(organizationId: string, client: Tx | Db = db()): Promise<OrgLimits> {
  const [s, sub] = await Promise.all([
    getOrgSettings(organizationId, client),
    client.subscription.findFirst({
      where: {
        organizationId,
        status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        plan: {
          select: {
            name: true,
            entitlements: {
              select: { featureKey: true, enabled: true, limitValue: true },
            },
          },
        },
      },
    }),
  ]);
  const ent = (key: string) => {
    const e = sub?.plan.entitlements.find((x) => x.featureKey === key);
    return e && e.enabled && e.limitValue !== null ? Number(e.limitValue) : null;
  };
  const companiesMax = ent("companies.max");
  return {
    maxMembers: s.maxMembers,
    maxCompanies: minNullable(s.maxCompanies, companiesMax),
    maxWorkspacesPerCompany: s.maxWorkspacesPerCompany,
    maxAiTokensPerDay: s.maxAiTokensPerDay,
    maxApiKeys: s.maxApiKeys,
    plan: {
      name: sub?.plan.name ?? null,
      companiesMax,
      agentsMax: ent("agents.max"),
    },
  };
}

export type LimitKind = "members" | "companies" | "workspaces" | "apiKeys" | "aiTokens";

/** Current usage for a limit. `companyId` is needed for workspaces/aiTokens (per company / per org today). */
export async function limitUsage(client: Tx | Db, organizationId: string, kind: LimitKind, companyId?: string): Promise<number> {
  switch (kind) {
    case "members":
      return client.membership.count({
        where: { organizationId, status: "ACTIVE" },
      });
    case "companies":
      return client.company.count({
        where: { organizationId, deletedAt: null },
      });
    case "workspaces":
      return client.workspace.count({
        where: { organizationId, ...(companyId ? { companyId } : {}) },
      });
    case "apiKeys":
      return client.apiKey.count({
        where: {
          organizationId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
    case "aiTokens": {
      const d = new Date();
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const r = await client.agentTask.aggregate({
        where: { organizationId, startedAt: { gte: start } },
        _sum: { inputTokens: true, outputTokens: true },
      });
      return (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0);
    }
  }
}

const LIMIT_FIELD: Record<LimitKind, keyof Omit<OrgLimits, "plan">> = {
  members: "maxMembers",
  companies: "maxCompanies",
  workspaces: "maxWorkspacesPerCompany",
  apiKeys: "maxApiKeys",
  aiTokens: "maxAiTokensPerDay",
};

/** Throw `not_available` (reason enterprise_limit_reached) when adding `adding` more would exceed the limit. */
export async function assertWithinLimit(organizationId: string, kind: LimitKind, opts: { client?: Tx | Db; companyId?: string; adding?: number } = {}) {
  const client = opts.client ?? db();
  const limit = (await getOrgLimits(organizationId, client))[LIMIT_FIELD[kind]];
  if (limit === null) return;
  const used = await limitUsage(client, organizationId, kind, opts.companyId);
  if (used + (opts.adding ?? 1) > limit)
    throw new AppError("not_available", `The organization's ${kind} limit (${limit}) is reached`, { reason: "enterprise_limit_reached", kind, limit, used });
}

const optionalLimit = z.number().int().min(0).max(10_000_000_000).nullable();
export const limitsInput = z.object({
  maxMembers: optionalLimit,
  maxCompanies: optionalLimit,
  maxWorkspacesPerCompany: optionalLimit,
  maxAiTokensPerDay: optionalLimit,
  maxApiKeys: optionalLimit,
});

export async function updateLimits(ctx: RequestContext, organizationId: string, raw: z.input<typeof limitsInput>) {
  const input = limitsInput.parse(raw);
  await transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "organizations.manage", tx);
    await saveSettings(tx, ctx, organizationId, input, "organization.limits_updated");
  });
  return getOrgLimits(organizationId);
}

// ───────────── Security controls ─────────────

/** Validate one allowlist entry: an IP address or an IPv4/IPv6 CIDR range. */
export function parseAllowEntry(entry: string): { address: string; prefix: number | null; family: "ipv4" | "ipv6" } | null {
  const [address, prefixRaw] = entry.trim().split("/");
  const v = isIP(address ?? "");
  if (!v) return null;
  const family = v === 4 ? "ipv4" : "ipv6";
  if (prefixRaw === undefined) return { address: address!, prefix: null, family };
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > (v === 4 ? 32 : 128)) return null;
  return { address: address!, prefix, family };
}

export function ipAllowed(ip: string | null, allowlist: string[]): boolean {
  if (!allowlist.length) return true;
  if (!ip || !isIP(ip)) return false;
  const list = new BlockList();
  for (const e of allowlist) {
    const p = parseAllowEntry(e);
    if (!p) continue;
    if (p.prefix === null) list.addAddress(p.address, p.family);
    else list.addSubnet(p.address, p.prefix, p.family);
  }
  return list.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
}

export type AccessViolation = "mfa_required" | "session_expired" | "ip_blocked";

/**
 * Organization security policy for a user request: MFA requirement, session timeout and IP allowlist. Non-user
 * principals (API keys) are subject to the IP allowlist only; SYSTEM is exempt.
 */
export async function orgAccessViolations(ctx: RequestContext, organizationId: string, client: Tx | Db = db()): Promise<AccessViolation[]> {
  if (ctx.actor.type === "SYSTEM" || !ctx.actor.id) return [];
  const s = await getOrgSettings(organizationId, client);
  const out: AccessViolation[] = [];
  if (!ipAllowed(ctx.ip, s.ipAllowlist) && !(ctx.ip === null && process.env.NODE_ENV !== "production")) out.push("ip_blocked");
  if (ctx.actor.type !== "USER") return out;
  if (s.requireMfa) {
    const user = await client.user.findUnique({
      where: { id: ctx.actor.id },
      select: { mfaEnabled: true },
    });
    if (!user?.mfaEnabled || !ctx.mfaVerifiedAt) out.push("mfa_required");
  }
  if (s.sessionTimeoutMinutes && ctx.sessionId) {
    const session = await client.session.findUnique({
      where: { id: ctx.sessionId },
      select: { createdAt: true },
    });
    if (session && Date.now() - session.createdAt.getTime() > s.sessionTimeoutMinutes * 60_000) out.push("session_expired");
  }
  return out;
}

/** Throw when the organization's security policy refuses this request (hook point for every tenant service). */
export async function assertOrgAccess(ctx: RequestContext, organizationId: string, client: Tx | Db = db()) {
  const v = await orgAccessViolations(ctx, organizationId, client);
  if (v.includes("mfa_required")) throw new AppError("mfa_required", "This organization requires two-factor authentication", { reason: "enterprise_mfa_required" });
  if (v.includes("session_expired"))
    throw new AppError("unauthenticated", "Your session exceeded the organization's session timeout; sign in again", { reason: "enterprise_session_expired" });
  if (v.includes("ip_blocked")) throw forbidden("Your network address is not on the organization's allowlist", { reason: "enterprise_ip_blocked" });
}

/** requirePermission + organization security policy. */
export async function authorizeOrg(ctx: RequestContext, organizationId: string, permission: string, tx?: Tx, chain?: ScopeChain) {
  await requirePermission(ctx, permission, chain ?? orgChain(organizationId), tx);
  await assertOrgAccess(ctx, organizationId, tx);
}

export const securityInput = z.object({
  requireMfa: z.boolean(),
  sessionTimeoutMinutes: z
    .number()
    .int()
    .min(15)
    .max(60 * 24 * 30)
    .nullable(),
  ipAllowlist: z.array(z.string().trim().max(60)).max(100),
});

export async function updateSecurity(ctx: RequestContext, organizationId: string, raw: z.input<typeof securityInput>) {
  const input = securityInput.parse(raw);
  const bad = input.ipAllowlist.filter((e) => !parseAllowEntry(e));
  if (bad.length)
    throw invalid(`Invalid IP or CIDR: ${bad.join(", ")}`, {
      reason: "enterprise_invalid_ip",
    });
  const ipAllowlist = [...new Set(input.ipAllowlist.map((e) => e.trim()))];
  await transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "organizations.manage", tx);
    // Lock-out guards: whoever turns a control on must satisfy it.
    if (input.requireMfa && ctx.actor.type === "USER") {
      const me = await tx.user.findUnique({
        where: { id: ctx.actor.id! },
        select: { mfaEnabled: true },
      });
      if (!me?.mfaEnabled) throw invalid("Enable two-factor authentication on your own account first", { reason: "enterprise_enable_own_mfa" });
    }
    if (ipAllowlist.length && ctx.ip && !ipAllowed(ctx.ip, ipAllowlist))
      throw invalid("Your current address would be blocked", {
        reason: "enterprise_ip_self_lockout",
      });
    await saveSettings(
      tx,
      ctx,
      organizationId,
      {
        requireMfa: input.requireMfa,
        sessionTimeoutMinutes: input.sessionTimeoutMinutes,
        ipAllowlist,
      },
      "organization.security_updated",
    );
  });
}

export const retentionInput = z.object({
  auditRetentionDays: z.number().int().min(30).max(3650).nullable(),
  dataRetentionDays: z.number().int().min(30).max(3650).nullable(),
});

export async function updateRetention(ctx: RequestContext, organizationId: string, raw: z.input<typeof retentionInput>) {
  const input = retentionInput.parse(raw);
  await transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "organizations.manage", tx);
    await saveSettings(tx, ctx, organizationId, input, "organization.retention_updated");
  });
}

export async function setEnforceSso(tx: Tx, ctx: RequestContext, organizationId: string, enforceSso: boolean) {
  await saveSettings(tx, ctx, organizationId, { enforceSso }, "organization.sso_enforcement_updated");
}

// ───────────── Sessions ─────────────

/** Live sessions of the organization's members (users.manage). */
export async function listMemberSessions(ctx: RequestContext, organizationId: string) {
  await authorizeOrg(ctx, organizationId, "users.manage");
  const now = new Date();
  return db().session.findMany({
    where: {
      revokedAt: null,
      expiresAt: { gt: now },
      mfaPending: false,
      user: { memberships: { some: { organizationId, status: "ACTIVE" } } },
    },
    orderBy: { lastSeenAt: "desc" },
    take: 300,
    select: {
      id: true,
      ip: true,
      userAgent: true,
      createdAt: true,
      lastSeenAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function revokeMemberSession(ctx: RequestContext, organizationId: string, sessionId: string) {
  if (!z.string().uuid().safeParse(sessionId).success) throw notFound("Session");
  await transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "users.manage", tx);
    const s = await tx.session.findFirst({
      where: {
        id: sessionId,
        revokedAt: null,
        user: { memberships: { some: { organizationId } } },
      },
      select: { id: true, userId: true },
    });
    if (!s) throw notFound("Session");
    await tx.session.update({
      where: { id: s.id },
      data: { revokedAt: new Date() },
    });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "session.revoked",
      resourceType: "session",
      resourceId: s.id,
      newValue: { userId: s.userId },
    });
  });
}

/** Members without two-factor authentication (shown before turning on the requirement). */
export async function membersWithoutMfa(organizationId: string) {
  return db().user.findMany({
    where: {
      mfaEnabled: false,
      memberships: { some: { organizationId, status: "ACTIVE" } },
    },
    select: { id: true, name: true, email: true },
    take: 200,
  });
}
