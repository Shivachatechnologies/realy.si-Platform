import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { getControls } from "@/server/core/platform-controls";
import { writeAudit } from "@/server/modules/audit/service";
import { revokeApiKey } from "@/server/modules/enterprise/api-keys";
import { isPlatformManaged } from "@/server/modules/integrations/catalog";
import { disconnectIntegration } from "@/server/modules/integrations/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { daysAgo, isUuid, reasonSchema, requireAnyPlatform } from "./access";

const READ = ["platform.security.read", "platform.organizations.read", "platform.controls.manage"];

const filters = z.object({
  provider: z.string().regex(/^[a-z0-9_.-]{1,60}$/).optional().catch(undefined),
  status: z.enum(["CONNECTED", "ERROR", "DISCONNECTED"]).optional().catch(undefined),
  org: z.string().uuid().optional().catch(undefined),
});

/**
 * Integrations & API across organizations: provider connections (status, last error — never credentials), API keys
 * (prefix only), outbound webhook delivery failures and API usage. Provider switches live in Platform Controls.
 */
export async function integrationsOverview(ctx: RequestContext, raw: Partial<Record<keyof z.input<typeof filters>, unknown>> = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = filters.parse(raw);
  const connWhere: Prisma.IntegrationConnectionWhereInput = { ...(f.provider ? { provider: f.provider } : {}), ...(f.status ? { status: f.status } : {}), ...(f.org ? { organizationId: f.org } : {}) };
  const [connections, byProvider, apiKeys, failedDeliveries, apiUsage, controls] = await Promise.all([
    db().integrationConnection.findMany({
      where: connWhere,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 100,
      select: { id: true, organizationId: true, provider: true, status: true, externalAccount: true, lastSyncAt: true, lastError: true, lastErrorAt: true, connectedAt: true, company: { select: { name: true } } },
    }),
    db().integrationConnection.groupBy({ by: ["provider", "status"], _count: { _all: true } }),
    db().apiKey.findMany({
      where: { ...(f.org ? { organizationId: f.org } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, organizationId: true, name: true, prefix: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true },
    }),
    db().integrationWebhookDelivery.findMany({
      where: { status: "FAILED", ...(f.org ? { organizationId: f.org } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, organizationId: true, eventType: true, attempts: true, lastStatusCode: true, lastError: true, updatedAt: true, subscription: { select: { name: true, url: true } } },
    }),
    db().usageRecord.groupBy({ by: ["organizationId"], where: { meter: "api.request", occurredAt: { gte: daysAgo(30) } }, _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 20 }),
    getControls(),
  ]);
  const orgIds = [...new Set([...connections, ...apiKeys, ...failedDeliveries, ...apiUsage].map((r) => r.organizationId))];
  const orgs = await db().organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? id.slice(0, 8);
  const providers = [...new Set(byProvider.map((p) => p.provider))].sort();
  return {
    connections: connections.map((c) => ({ ...c, organizationName: orgName(c.organizationId) })),
    providers: providers.map((p) => ({
      provider: p,
      connected: byProvider.find((b) => b.provider === p && b.status === "CONNECTED")?._count._all ?? 0,
      error: byProvider.find((b) => b.provider === p && b.status === "ERROR")?._count._all ?? 0,
      disconnected: byProvider.find((b) => b.provider === p && b.status === "DISCONNECTED")?._count._all ?? 0,
      disabled: controls.disabledIntegrations.includes(p),
    })),
    disabledIntegrations: controls.disabledIntegrations,
    apiKeys: apiKeys.map((k) => ({ ...k, organizationName: orgName(k.organizationId) })),
    failedDeliveries: failedDeliveries.map((d) => ({ ...d, organizationName: orgName(d.organizationId) })),
    apiUsage: apiUsage.map((u) => ({ organizationId: u.organizationId, organizationName: orgName(u.organizationId), requests: Number(u._sum.quantity ?? 0) })),
  };
}

/** Revoke any organization's API key (enterprise api-keys service as system principal), audited as the admin. */
export async function adminRevokeApiKey(ctx: RequestContext, keyId: string, raw: { reason?: string }) {
  const reason = reasonSchema.parse(raw.reason);
  await requirePermission(ctx, "platform.security.manage", platformChain());
  if (!isUuid(keyId)) throw notFound("API key");
  const key = await db().apiKey.findUnique({ where: { id: keyId }, select: { organizationId: true, prefix: true, name: true, revokedAt: true } });
  if (!key) throw notFound("API key");
  await revokeApiKey(systemContext(ctx.requestId), key.organizationId, keyId);
  await transaction((tx) =>
    writeAudit(tx, ctx, { category: "SECURITY", organizationId: key.organizationId, action: "platform.api_key_revoked", resourceType: "api_key", resourceId: keyId, oldValue: { prefix: key.prefix, name: key.name }, reason }),
  );
  return { ok: true };
}

/**
 * Disconnect any organization's integration connection (docs/integrations.md "Who manages what"): revokes the token at
 * the provider where supported and clears the stored credentials, exactly like the customer's own Disconnect. Runs the
 * integrations service as trusted platform code on the admin's behalf (actor id kept for the record) and is audited as
 * the admin with a reason. Legacy rows of platform-managed providers are left alone: they are unused, never deleted.
 */
export async function adminDisconnectIntegration(ctx: RequestContext, connectionId: string, raw: { reason?: string }) {
  const reason = reasonSchema.parse(raw.reason);
  await requireAnyPlatform(ctx, ["platform.organizations.manage", "platform.controls.manage"]);
  if (!isUuid(connectionId)) throw notFound("Connection");
  const row = await db().integrationConnection.findUnique({ where: { id: connectionId }, select: { organizationId: true, companyId: true, provider: true, status: true } });
  if (!row || row.status === "DISCONNECTED" || isPlatformManaged(row.provider)) throw notFound("Connection");
  const staff: RequestContext = { ...ctx, actor: { type: "SYSTEM", id: ctx.actor.id } };
  const result = await disconnectIntegration(staff, row.organizationId, row.companyId, row.provider);
  await transaction((tx) =>
    writeAudit(tx, ctx, { category: "ADMIN", organizationId: row.organizationId, action: "platform.integration_disconnected", resourceType: "integration_connection", resourceId: connectionId, oldValue: { provider: row.provider, status: row.status }, reason }),
  );
  return result;
}
