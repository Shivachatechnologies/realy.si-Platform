import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { writeAudit } from "@/server/modules/audit/service";
import { MAX_DELIVERY_ATTEMPTS, attemptDelivery, redeliver } from "@/server/modules/integrations/webhooks";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { daysAgo, isUuid, reasonSchema, requireAnyPlatform } from "./access";

/**
 * Webhook control center (Admin → Webhooks, stream F): outbound endpoints (tenant `integration_webhook_subscriptions`)
 * with delivery health, a delivery explorer (payload, attempts, last response), admin redeliver / test / pause /
 * resume, and the inbound log (Stripe, provider events, email provider events). Secrets (`secretEnc`) never leave
 * the server. Latency is not recorded per delivery (no duration column), so it is shown as "not yet tracked".
 */

/** Same permissions as the `webhooks` console section. */
const READ = ["platform.security.read", "platform.security.manage"];
const MANAGE = "platform.security.manage";

/** Retry schedule of `integrations/webhooks.ts` (minutes after attempt 1…5), shown as the retry policy. */
export const RETRY_POLICY = { maxAttempts: MAX_DELIVERY_ATTEMPTS, backoffMinutes: [1, 5, 30, 120, 360], timeoutSeconds: 10 };

const endpointFilters = z.object({
  org: z.string().uuid().optional().catch(undefined),
  state: z.enum(["active", "paused", "failing"]).optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
  cursor: z.string().uuid().optional().catch(undefined),
  limit: z.coerce.number().int().min(10).max(100).default(50).catch(50),
});

const orgNames = async (ids: (string | null | undefined)[]) => {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = list.length ? await db().organization.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
  return (id: string | null | undefined) => (id ? (rows.find((o) => o.id === id)?.name ?? id.slice(0, 8)) : null);
};

/** Endpoints with 7-day delivery stats (counts per status, failure rate, last delivery). Keyset pagination. */
export async function webhookEndpoints(ctx: RequestContext, raw: Partial<Record<keyof z.input<typeof endpointFilters>, unknown>> = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = endpointFilters.parse(raw);
  const d7 = daysAgo(7);
  let failingIds: string[] | undefined;
  if (f.state === "failing") {
    const rows = await db().integrationWebhookDelivery.groupBy({ by: ["subscriptionId"], where: { status: "FAILED", updatedAt: { gte: d7 } }, _count: { _all: true }, orderBy: { subscriptionId: "asc" }, take: 500 });
    failingIds = rows.map((r) => r.subscriptionId);
  }
  const where: Prisma.IntegrationWebhookSubscriptionWhereInput = {
    ...(f.org ? { organizationId: f.org } : {}),
    ...(f.state === "active" ? { active: true } : f.state === "paused" ? { active: false } : {}),
    ...(failingIds ? { id: { in: failingIds } } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { url: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const subs = await db().integrationWebhookSubscription.findMany({
    where,
    orderBy: { id: "desc" },
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    select: { id: true, organizationId: true, companyId: true, name: true, url: true, eventTypes: true, active: true, createdAt: true, updatedAt: true, company: { select: { name: true } } },
  });
  const hasMore = subs.length > f.limit;
  const page = hasMore ? subs.slice(0, f.limit) : subs;
  const ids = page.map((s) => s.id);
  const [stats, last, totals] = await Promise.all([
    ids.length ? db().integrationWebhookDelivery.groupBy({ by: ["subscriptionId", "status"], where: { subscriptionId: { in: ids }, createdAt: { gte: d7 } }, _count: { _all: true } }) : [],
    ids.length ? db().integrationWebhookDelivery.groupBy({ by: ["subscriptionId"], where: { subscriptionId: { in: ids } }, _max: { createdAt: true, deliveredAt: true } }) : [],
    db().integrationWebhookDelivery.groupBy({ by: ["status"], where: { createdAt: { gte: d7 } }, _count: { _all: true } }),
  ]);
  const name = await orgNames(page.map((s) => s.organizationId));
  const stat = (id: string, s: string) => stats.find((d) => d.subscriptionId === id && d.status === s)?._count._all ?? 0;
  const total = (s: string) => totals.find((t) => t.status === s)?._count._all ?? 0;
  const [succeeded, failed, pending] = [total("SUCCEEDED"), total("FAILED"), total("PENDING")];
  return {
    filters: f,
    retryPolicy: RETRY_POLICY,
    totals: { succeeded, failed, pending, failureRate: succeeded + failed ? failed / (succeeded + failed) : null },
    data: page.map((s) => {
      const ok = stat(s.id, "SUCCEEDED");
      const bad = stat(s.id, "FAILED");
      const l = last.find((x) => x.subscriptionId === s.id);
      return { ...s, organizationName: name(s.organizationId), succeeded7d: ok, failed7d: bad, pending: stat(s.id, "PENDING"), failureRate: ok + bad ? bad / (ok + bad) : null, lastDeliveryAt: l?._max.createdAt ?? null, lastSuccessAt: l?._max.deliveredAt ?? null };
    }),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

const deliveryFilters = z.object({
  status: z.enum(["PENDING", "SUCCEEDED", "FAILED"]).optional().catch(undefined),
  cursor: z.string().uuid().optional().catch(undefined),
});

/** One endpoint: metadata (no secret), 7-day stats and its deliveries (keyset pages of 50). */
export async function webhookEndpoint(ctx: RequestContext, subscriptionId: string, raw: Partial<Record<keyof z.input<typeof deliveryFilters>, unknown>> = {}) {
  await requireAnyPlatform(ctx, READ);
  if (!isUuid(subscriptionId)) throw notFound("Webhook");
  const f = deliveryFilters.parse(raw);
  const sub = await db().integrationWebhookSubscription.findUnique({
    where: { id: subscriptionId },
    select: { id: true, organizationId: true, companyId: true, name: true, url: true, eventTypes: true, active: true, createdById: true, createdAt: true, updatedAt: true, company: { select: { name: true } } },
  });
  if (!sub) throw notFound("Webhook");
  const d7 = daysAgo(7);
  const [deliveries, stats, audit, creator] = await Promise.all([
    db().integrationWebhookDelivery.findMany({
      where: { subscriptionId, ...(f.status ? { status: f.status } : {}) },
      orderBy: { id: "desc" },
      take: 51,
      ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
      select: { id: true, eventType: true, status: true, attempts: true, lastStatusCode: true, lastError: true, nextAttemptAt: true, deliveredAt: true, createdAt: true, updatedAt: true },
    }),
    db().integrationWebhookDelivery.groupBy({ by: ["status"], where: { subscriptionId, createdAt: { gte: d7 } }, _count: { _all: true } }),
    db().auditLog.findMany({ where: { resourceType: { in: ["webhook_subscription", "integration_webhook"] }, resourceId: subscriptionId }, orderBy: { id: "desc" }, take: 20, select: { id: true, action: true, actorId: true, reason: true, createdAt: true } }),
    db().user.findUnique({ where: { id: sub.createdById }, select: { name: true, email: true } }),
  ]);
  const hasMore = deliveries.length > 50;
  const count = (s: string) => stats.find((x) => x.status === s)?._count._all ?? 0;
  const name = await orgNames([sub.organizationId]);
  return {
    endpoint: { ...sub, organizationName: name(sub.organizationId), createdBy: creator },
    stats: { succeeded: count("SUCCEEDED"), failed: count("FAILED"), pending: count("PENDING") },
    deliveries: hasMore ? deliveries.slice(0, 50) : deliveries,
    nextCursor: hasMore ? deliveries[49]!.id : null,
    audit,
    retryPolicy: RETRY_POLICY,
  };
}

/** One delivery with its payload (tenant event data: shown to staff with webhook read access, never the secret). */
export async function webhookDelivery(ctx: RequestContext, deliveryId: string) {
  await requireAnyPlatform(ctx, READ);
  if (!isUuid(deliveryId)) throw notFound("Delivery");
  const d = await db().integrationWebhookDelivery.findUnique({ where: { id: deliveryId }, include: { subscription: { select: { id: true, name: true, url: true, active: true } } } });
  if (!d) throw notFound("Delivery");
  return d;
}

export const webhookActionInput = z.object({ reason: reasonSchema });

/** Admin redeliver: the tenant redeliver service (as trusted platform code) plus an admin SECURITY audit record. */
export async function adminRedeliver(ctx: RequestContext, deliveryId: string, raw: z.input<typeof webhookActionInput>) {
  const { reason } = webhookActionInput.parse(raw);
  await requirePermission(ctx, MANAGE, platformChain());
  if (!isUuid(deliveryId)) throw notFound("Delivery");
  const d = await db().integrationWebhookDelivery.findUnique({ where: { id: deliveryId }, select: { id: true, organizationId: true, companyId: true, status: true, subscription: { select: { active: true } } } });
  if (!d) throw notFound("Delivery");
  if (!d.subscription.active) throw conflict("Resume the endpoint before redelivering", { reason: "webhook_paused" });
  const result = await redeliver(systemContext(ctx.requestId), d.organizationId, d.companyId, d.id);
  await transaction((tx) =>
    writeAudit(tx, ctx, { category: "SECURITY", organizationId: d.organizationId, action: "platform.webhook_redelivered", resourceType: "integration_webhook_delivery", resourceId: d.id, oldValue: { status: d.status }, newValue: { status: result?.status ?? null }, reason }),
  );
  return { status: result?.status ?? null };
}

export const pauseInput = z.object({ paused: z.boolean(), reason: reasonSchema });

/**
 * Pause (active = false, pending retries parked: nextAttemptAt cleared so the retry job skips them) or resume (active,
 * parked retries due now). Disabling for good (pending → FAILED) is `developers.ts#setWebhookActive`.
 */
export async function setWebhookPaused(ctx: RequestContext, subscriptionId: string, raw: z.input<typeof pauseInput>) {
  const input = pauseInput.parse(raw);
  if (!isUuid(subscriptionId)) throw notFound("Webhook");
  return transaction(async (tx) => {
    await requirePermission(ctx, MANAGE, platformChain(), tx);
    const s = await tx.integrationWebhookSubscription.findUnique({ where: { id: subscriptionId }, select: { id: true, organizationId: true, active: true, name: true } });
    if (!s) throw notFound("Webhook");
    if (s.active === !input.paused) throw conflict(input.paused ? "The endpoint is already paused" : "The endpoint is already active");
    await tx.integrationWebhookSubscription.update({ where: { id: s.id }, data: { active: !input.paused } });
    const parked = input.paused
      ? await tx.integrationWebhookDelivery.updateMany({ where: { subscriptionId: s.id, status: "PENDING" }, data: { nextAttemptAt: null } })
      : await tx.integrationWebhookDelivery.updateMany({ where: { subscriptionId: s.id, status: "PENDING", nextAttemptAt: null }, data: { nextAttemptAt: new Date() } });
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId: s.organizationId, action: input.paused ? "platform.webhook_paused" : "platform.webhook_resumed", resourceType: "webhook_subscription", resourceId: s.id, oldValue: { active: s.active }, newValue: { active: !input.paused, pendingAffected: parked.count }, reason: input.reason });
    return { id: s.id, active: !input.paused, pendingAffected: parked.count };
  });
}

/** Send a signed `webhook.test` event to the endpoint now (one delivery row, audited). */
export async function sendTestDelivery(ctx: RequestContext, subscriptionId: string, raw: z.input<typeof webhookActionInput>) {
  const { reason } = webhookActionInput.parse(raw);
  if (!isUuid(subscriptionId)) throw notFound("Webhook");
  const delivery = await transaction(async (tx) => {
    await requirePermission(ctx, MANAGE, platformChain(), tx);
    const s = await tx.integrationWebhookSubscription.findUnique({ where: { id: subscriptionId }, select: { id: true, organizationId: true, companyId: true, active: true } });
    if (!s) throw notFound("Webhook");
    if (!s.active) throw conflict("Resume the endpoint before sending a test", { reason: "webhook_paused" });
    const eventId = randomUUID();
    const payload = { id: eventId, type: "webhook.test", occurredAt: new Date().toISOString(), companyId: s.companyId, entityType: "webhook_subscription", entityId: s.id, data: { message: "Test delivery sent by Realy support" } };
    const d = await tx.integrationWebhookDelivery.create({ data: { organizationId: s.organizationId, companyId: s.companyId, subscriptionId: s.id, eventId, eventType: "webhook.test", payload: toJson(payload), nextAttemptAt: new Date() }, select: { id: true } });
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId: s.organizationId, action: "platform.webhook_test_sent", resourceType: "webhook_subscription", resourceId: s.id, newValue: { deliveryId: d.id }, reason });
    return d;
  });
  const result = await attemptDelivery(delivery.id);
  return { deliveryId: delivery.id, status: result?.status ?? null, statusCode: result && "statusCode" in result ? (result.statusCode ?? null) : null };
}

const inboundFilters = z.object({
  source: z.enum(["stripe", "provider", "email"]).default("provider").catch("provider"),
  cursor: z.string().max(200).optional().catch(undefined),
});

/**
 * Inbound webhook log. Stripe (`stripe_events`: id, type, outcome; payloads are not stored), integration provider
 * events and email provider events. Voice, Twilio and WhatsApp inbound requests are not logged anywhere yet.
 */
export async function inboundWebhooks(ctx: RequestContext, raw: Partial<Record<keyof z.input<typeof inboundFilters>, unknown>> = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = inboundFilters.parse(raw);
  const take = 51;
  const d7 = daysAgo(7);
  if (f.source === "stripe") {
    const [rows, byOutcome] = await Promise.all([
      db().stripeEvent.findMany({ where: f.cursor ? { processedAt: { lt: new Date(f.cursor) } } : {}, orderBy: { processedAt: "desc" }, take }),
      db().stripeEvent.groupBy({ by: ["outcome"], where: { processedAt: { gte: d7 } }, _count: { _all: true } }),
    ]);
    const more = rows.length > 50;
    const page = more ? rows.slice(0, 50) : rows;
    return {
      source: f.source,
      byOutcome: byOutcome.map((b) => ({ key: b.outcome, count: b._count._all })),
      rows: page.map((r) => ({ id: r.id, type: r.type, status: r.outcome, organizationId: r.organizationId, provider: r.livemode ? "stripe (live)" : "stripe (test)", at: r.processedAt, error: null as string | null })),
      nextCursor: more ? page[page.length - 1]!.processedAt.toISOString() : null,
    };
  }
  if (f.source === "email") {
    const cursor = f.cursor && isUuid(f.cursor) ? f.cursor : undefined;
    const [rows, byType] = await Promise.all([
      db().emailEvent.findMany({ orderBy: { id: "desc" }, take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
      db().emailEvent.groupBy({ by: ["type"], where: { occurredAt: { gte: d7 } }, _count: { _all: true } }),
    ]);
    const more = rows.length > 50;
    const page = more ? rows.slice(0, 50) : rows;
    return {
      source: f.source,
      byOutcome: byType.map((b) => ({ key: b.type, count: b._count._all })),
      rows: page.map((r) => ({ id: r.id, type: r.type, status: r.type, organizationId: null as string | null, provider: r.provider, at: r.occurredAt, error: null as string | null })),
      nextCursor: more ? page[page.length - 1]!.id : null,
    };
  }
  const cursor = f.cursor && isUuid(f.cursor) ? f.cursor : undefined;
  const [rows, byStatus] = await Promise.all([
    db().integrationProviderEvent.findMany({ orderBy: { id: "desc" }, take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, organizationId: true, provider: true, eventType: true, status: true, error: true, receivedAt: true } }),
    db().integrationProviderEvent.groupBy({ by: ["status"], where: { receivedAt: { gte: d7 } }, _count: { _all: true } }),
  ]);
  const more = rows.length > 50;
  const page = more ? rows.slice(0, 50) : rows;
  return {
    source: f.source,
    byOutcome: byStatus.map((b) => ({ key: b.status, count: b._count._all })),
    rows: page.map((r) => ({ id: r.id, type: r.eventType, status: r.status, organizationId: r.organizationId, provider: r.provider, at: r.receivedAt, error: r.error })),
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}
