import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { LIMITS } from "@/server/core/limits";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { daysAgo, isUuid, reasonSchema, requireAnyPlatform } from "./access";

/**
 * API & webhooks across tenants (Admin → Integrations → API & webhooks): API keys (prefix only, never secrets) with
 * revoke (admin/integrations.ts adminRevokeApiKey), outbound webhook subscriptions with delivery health and
 * disable / re-enable, and the recent delivery failures.
 */

const READ = ["platform.security.read", "platform.organizations.read", "platform.controls.manage"];
const filters = z.object({
  org: z.string().uuid().optional().catch(undefined),
  keys: z.enum(["active", "revoked", "expired"]).optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
});

export async function developersOverview(ctx: RequestContext, raw: Partial<Record<keyof z.input<typeof filters>, unknown>> = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = filters.parse(raw);
  const now = new Date();
  const keyWhere: Prisma.ApiKeyWhereInput = {
    ...(f.org ? { organizationId: f.org } : {}),
    ...(f.keys === "active" ? { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } : f.keys === "revoked" ? { revokedAt: { not: null } } : f.keys === "expired" ? { revokedAt: null, expiresAt: { lte: now } } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { prefix: { startsWith: f.q } }] } : {}),
  };
  const d7 = daysAgo(7);
  const [keys, keyCounts, subs, deliveryStats, failures] = await Promise.all([
    db().apiKey.findMany({ where: keyWhere, orderBy: { createdAt: "desc" }, take: 150, select: { id: true, organizationId: true, name: true, prefix: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true, serviceAccount: { select: { name: true, disabledAt: true } } } }),
    Promise.all([
      db().apiKey.count({ where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      db().apiKey.count({ where: { lastUsedAt: { gte: d7 }, revokedAt: null } }),
    ]),
    db().integrationWebhookSubscription.findMany({ where: { ...(f.org ? { organizationId: f.org } : {}) }, orderBy: { createdAt: "desc" }, take: 150, select: { id: true, organizationId: true, companyId: true, name: true, url: true, eventTypes: true, active: true, createdAt: true, company: { select: { name: true } } } }),
    db().integrationWebhookDelivery.groupBy({ by: ["subscriptionId", "status"], where: { createdAt: { gte: d7 }, ...(f.org ? { organizationId: f.org } : {}) }, _count: { _all: true } }),
    db().integrationWebhookDelivery.findMany({
      where: { status: "FAILED", ...(f.org ? { organizationId: f.org } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, organizationId: true, subscriptionId: true, eventType: true, attempts: true, lastStatusCode: true, lastError: true, updatedAt: true, subscription: { select: { name: true, url: true } } },
    }),
  ]);
  const orgIds = [...new Set([...keys, ...subs, ...failures].map((r) => r.organizationId))];
  const orgs = await db().organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? id.slice(0, 8);
  const stat = (id: string, s: string) => deliveryStats.find((d) => d.subscriptionId === id && d.status === s)?._count._all ?? 0;
  return {
    keys: keys.map((k) => ({ ...k, organizationName: orgName(k.organizationId), state: keyState(k, now) })),
    keyCounts: { active: keyCounts[0], used7d: keyCounts[1] },
    webhooks: subs.map((s) => ({ ...s, organizationName: orgName(s.organizationId), delivered7d: stat(s.id, "SUCCEEDED"), failed7d: stat(s.id, "FAILED"), pending: stat(s.id, "PENDING") })),
    failures: failures.map((d) => ({ ...d, organizationName: orgName(d.organizationId) })),
  };
}

export const webhookStateInput = z.object({ active: z.boolean(), reason: reasonSchema });

/** Disable (stops new deliveries) or re-enable any tenant's outbound webhook subscription. */
export async function setWebhookActive(ctx: RequestContext, subscriptionId: string, raw: z.input<typeof webhookStateInput>) {
  const input = webhookStateInput.parse(raw);
  if (!isUuid(subscriptionId)) throw notFound("Webhook");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.security.manage", platformChain(), tx);
    const s = await tx.integrationWebhookSubscription.findUnique({ where: { id: subscriptionId }, select: { id: true, organizationId: true, active: true, url: true, name: true } });
    if (!s) throw notFound("Webhook");
    if (s.active === input.active) throw conflict(input.active ? "The webhook is already active" : "The webhook is already disabled");
    await tx.integrationWebhookSubscription.update({ where: { id: s.id }, data: { active: input.active } });
    if (!input.active) await tx.integrationWebhookDelivery.updateMany({ where: { subscriptionId: s.id, status: "PENDING" }, data: { status: "FAILED", lastError: "Disabled by platform administrator" } });
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId: s.organizationId, action: input.active ? "platform.webhook_enabled" : "platform.webhook_disabled", resourceType: "webhook_subscription", resourceId: s.id, oldValue: { active: s.active }, newValue: { active: input.active, name: s.name }, reason: input.reason });
    return { id: s.id, active: input.active };
  });
}

// ───────────── API key detail and admin actions (Admin → Developers → key) ─────────────

/** Rate-limit presets that apply to API-key requests (keyed by the key's service-account principal). */
export const API_KEY_RATE_LIMITS = Object.entries(LIMITS)
  .flatMap(([preset, rules]) => (rules as readonly { name: string; limit: number; windowMs: number; by: unknown }[]).filter((r) => r.by === "principal").map((r) => ({ preset, rule: r.name, limit: r.limit, windowSeconds: r.windowMs / 1000 })))
  .filter((r) => !r.rule.startsWith("admin") && !r.rule.startsWith("platform"));

const keyState = (k: { revokedAt: Date | null; expiresAt: Date | null; serviceAccount: { disabledAt: Date | null } }, now = new Date()) =>
  k.revokedAt ? "revoked" : k.expiresAt && k.expiresAt <= now ? "expired" : k.serviceAccount.disabledAt ? "disabled" : "active";

/**
 * One API key: owner organization and creator, scopes, expiry, last use, the 30-day `api.request` meter of its
 * organization (usage is metered per organization, not per key), the sampled request log of the key (by day and
 * route, last IP hash), 429 events of its principal, the applicable rate limits and the audit history.
 */
export async function apiKeyDetail(ctx: RequestContext, keyId: string) {
  await requireAnyPlatform(ctx, READ);
  if (!isUuid(keyId)) throw notFound("API key");
  const key = await db().apiKey.findUnique({
    where: { id: keyId },
    select: { id: true, organizationId: true, serviceAccountId: true, name: true, prefix: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true, serviceAccount: { select: { name: true, disabledAt: true } } },
  });
  if (!key) throw notFound("API key");
  const d30 = daysAgo(30);
  const [meta, org, byDay, byRoute, last, orgMeter, limited, audit] = await Promise.all([
    db().enterpriseApiKeyMeta.findUnique({ where: { apiKeyId: key.id }, select: { scopes: true, createdById: true } }),
    db().organization.findUnique({ where: { id: key.organizationId }, select: { id: true, name: true, status: true } }),
    db().$queryRaw<{ day: Date; n: bigint; errors: bigint }[]>`
      SELECT date_trunc('day', created_at) AS day, count(*)::bigint AS n, count(*) FILTER (WHERE status >= 400)::bigint AS errors
      FROM api_request_logs WHERE api_key_id = ${key.id}::uuid AND created_at >= ${d30} GROUP BY 1 ORDER BY 1`,
    db().apiRequestLog.groupBy({ by: ["route"], where: { apiKeyId: key.id, createdAt: { gte: d30 } }, _count: { _all: true }, orderBy: { _count: { route: "desc" } }, take: 10 }),
    db().apiRequestLog.findFirst({ where: { apiKeyId: key.id }, orderBy: { id: "desc" }, select: { ipHash: true, createdAt: true, route: true, status: true } }),
    db().usageRecord.aggregate({ where: { organizationId: key.organizationId, meter: "api.request", occurredAt: { gte: d30 } }, _sum: { quantity: true } }),
    db().rateLimitEvent.count({ where: { userId: key.serviceAccountId, createdAt: { gte: daysAgo(14) } } }),
    db().auditLog.findMany({ where: { resourceType: "api_key", resourceId: key.id }, orderBy: { id: "desc" }, take: 30, select: { id: true, action: true, actorId: true, actorType: true, reason: true, createdAt: true, oldValue: true, newValue: true } }),
  ]);
  const creator = meta ? await db().user.findUnique({ where: { id: meta.createdById }, select: { id: true, name: true, email: true } }) : null;
  const now = new Date();
  const ageDays = Math.floor((now.getTime() - key.createdAt.getTime()) / 86_400_000);
  return {
    key: { ...key, state: keyState(key, now), ageDays },
    organization: org,
    creator,
    scopes: meta?.scopes ?? [],
    risk: {
      neverUsed: !key.lastUsedAt,
      staleDays: key.lastUsedAt ? Math.floor((now.getTime() - key.lastUsedAt.getTime()) / 86_400_000) : null,
      noExpiry: !key.expiresAt,
      broadScopes: (meta?.scopes ?? []).filter((s) => s.endsWith(".manage") || s.endsWith(".delete")).length,
      old: ageDays > 365,
    },
    usage: { orgRequests30d: Number(orgMeter._sum.quantity ?? 0), sampledByDay: byDay.map((d) => ({ day: d.day.toISOString().slice(0, 10), count: Number(d.n), errors: Number(d.errors) })), routes: byRoute.map((r) => ({ route: r.route, count: r._count._all })), last },
    rateLimits: API_KEY_RATE_LIMITS,
    limited14d: limited,
    audit,
  };
}

export const apiKeyStateInput = z.object({ disabled: z.boolean(), reason: reasonSchema });

/** Disable (service account disabled: every request answers 401) or re-enable a key without revoking it. */
export async function setApiKeyDisabled(ctx: RequestContext, keyId: string, raw: z.input<typeof apiKeyStateInput>) {
  const input = apiKeyStateInput.parse(raw);
  if (!isUuid(keyId)) throw notFound("API key");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.security.manage", platformChain(), tx);
    const key = await tx.apiKey.findUnique({ where: { id: keyId }, select: { id: true, organizationId: true, serviceAccountId: true, revokedAt: true, prefix: true, serviceAccount: { select: { disabledAt: true } } } });
    if (!key) throw notFound("API key");
    if (key.revokedAt) throw conflict("The key is revoked");
    if (!!key.serviceAccount.disabledAt === input.disabled) throw conflict(input.disabled ? "The key is already disabled" : "The key is already enabled");
    await tx.serviceAccount.update({ where: { id: key.serviceAccountId }, data: { disabledAt: input.disabled ? new Date() : null } });
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId: key.organizationId, action: input.disabled ? "platform.api_key_disabled" : "platform.api_key_enabled", resourceType: "api_key", resourceId: key.id, oldValue: { disabled: !!key.serviceAccount.disabledAt }, newValue: { disabled: input.disabled, prefix: key.prefix }, reason: input.reason });
    return { id: key.id, disabled: input.disabled };
  });
}

export const apiKeyRestrictInput = z.object({
  /** Keep only these scopes (must be a non-empty subset of the current ones). */
  scopes: z.array(z.string().max(120)).min(1).max(200).optional(),
  /** Expire the key in this many days (only ever earlier than today's expiry). */
  expiresInDays: z.number().int().min(0).max(730).optional(),
  reason: reasonSchema,
});

/**
 * Restrict a key: narrow its scopes (role permissions of the key's managed role) and/or bring its expiry forward.
 * Never widens access: new scopes must be a subset, a new expiry must be earlier. `expiresInDays: 0` expires it now.
 * "Rotate" is a restriction with a grace period: the owner creates the replacement key before the old one expires
 * (the secret of a tenant key is never generated for, or shown to, platform staff).
 */
export async function restrictApiKey(ctx: RequestContext, keyId: string, raw: z.input<typeof apiKeyRestrictInput>) {
  const input = apiKeyRestrictInput.parse(raw);
  if (!isUuid(keyId)) throw notFound("API key");
  if (!input.scopes && input.expiresInDays === undefined) throw invalid("Choose scopes to keep or a new expiry");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.security.manage", platformChain(), tx);
    const key = await tx.apiKey.findUnique({ where: { id: keyId }, select: { id: true, organizationId: true, serviceAccountId: true, revokedAt: true, expiresAt: true, prefix: true } });
    if (!key) throw notFound("API key");
    if (key.revokedAt) throw conflict("The key is revoked");
    const meta = await tx.enterpriseApiKeyMeta.findUnique({ where: { apiKeyId: key.id } });
    const before = { scopes: meta?.scopes ?? [], expiresAt: key.expiresAt };
    const after: { scopes: string[]; expiresAt: Date | null } = { ...before };
    if (input.scopes) {
      if (!meta) throw conflict("This key has no managed scopes to narrow");
      const keep = [...new Set(input.scopes)];
      const extra = keep.filter((s) => !meta.scopes.includes(s));
      if (extra.length) throw invalid(`Scopes can only be removed, not added: ${extra.join(", ")}`, { reason: "scope_widening" });
      const remove = meta.scopes.filter((s) => !keep.includes(s));
      if (remove.length) {
        const perms = await tx.permission.findMany({ where: { key: { in: remove } }, select: { id: true } });
        await tx.rolePermission.deleteMany({ where: { roleId: meta.roleId, permissionId: { in: perms.map((p) => p.id) } } });
        await tx.enterpriseApiKeyMeta.update({ where: { id: meta.id }, data: { scopes: keep } });
      }
      after.scopes = keep;
    }
    if (input.expiresInDays !== undefined) {
      const at = new Date(Date.now() + input.expiresInDays * 86_400_000);
      if (key.expiresAt && key.expiresAt <= at) throw invalid("The key already expires earlier", { reason: "expiry_not_earlier" });
      await tx.apiKey.update({ where: { id: key.id }, data: { expiresAt: at } });
      await tx.roleAssignment.updateMany({ where: { principalType: "SERVICE_ACCOUNT", principalId: key.serviceAccountId }, data: { expiresAt: at } });
      after.expiresAt = at;
    }
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId: key.organizationId, action: "platform.api_key_restricted", resourceType: "api_key", resourceId: key.id, oldValue: before, newValue: { ...after, prefix: key.prefix }, reason: input.reason });
    return { id: key.id, ...after };
  });
}
