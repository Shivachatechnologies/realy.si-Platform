import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
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
    db().apiKey.findMany({ where: keyWhere, orderBy: { createdAt: "desc" }, take: 150, select: { id: true, organizationId: true, name: true, prefix: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true, serviceAccount: { select: { name: true } } } }),
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
    keys: keys.map((k) => ({ ...k, organizationName: orgName(k.organizationId), state: k.revokedAt ? "revoked" : k.expiresAt && k.expiresAt <= now ? "expired" : "active" })),
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
