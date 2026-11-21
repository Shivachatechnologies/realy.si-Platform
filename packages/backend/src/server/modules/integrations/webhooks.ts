import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { decryptSecret, encryptSecret, hmacSha256, randomToken } from "@/server/core/crypto";
import { env } from "@/server/core/env";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { logger } from "@/server/core/logger";
import { consume } from "@/server/core/rate-limit";
import type { OutboxEvent } from "@/server/modules/events/relay";
import { DOMAIN_EVENTS } from "@/server/modules/events/catalog";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { writeAudit } from "@/server/modules/audit/service";
import { authorizeIntegrations } from "./service";
import { dispatchJob, WEBHOOKS_QUEUE } from "@/server/core/jobs";
import { HOOK_VERIFICATIONS, isProviderPreset, verifyHookSignature } from "./webhook-signatures";

const uuid = z.string().uuid();
const isUuid = (v: string) => uuid.safeParse(v).success;

// ───────────────────────────── Incoming webhooks (hooks) ─────────────────────────────

const hookPurpose = (hookId: string) => `integrations.hook:${hookId}`;
const subPurpose = (id: string) => `integrations.webhook:${id}`;

const hookFields = z.object({
  name: z.string().trim().min(1).max(120),
  verification: z.enum(HOOK_VERIFICATIONS).default("TOKEN"),
  signatureHeader: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{1,64}$/)
    .default("x-realy-signature"),
  /** Provider presets (STRIPE, GITHUB, SHOPIFY, SLACK): the signing secret the provider issued. Stored encrypted, never returned. */
  signingSecret: z.string().trim().min(8).max(500).optional(),
});
export const hookInput = hookFields.refine((v) => !isProviderPreset(v.verification) || !!v.signingSecret, { message: "Enter the signing secret the provider shows for this webhook", path: ["signingSecret"] });
export const hookUpdateInput = hookFields.partial().extend({ active: z.boolean().optional() });

export const hookUrl = (hookId: string) => `${env().APP_URL}/api/v1/hooks/${hookId}`;

const hookSelect = { id: true, name: true, verification: true, signatureHeader: true, active: true, lastReceivedAt: true, createdAt: true } satisfies Prisma.IntegrationHookSelect;

export async function listHooks(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.read");
  const hooks = await db().integrationHook.findMany({ where: { organizationId, companyId }, orderBy: { createdAt: "desc" }, select: { ...hookSelect, _count: { select: { deliveries: true } } } });
  return hooks.map((h) => ({ ...h, url: hookUrl(h.id) }));
}

/** Create an incoming webhook; the secret is returned once and stored encrypted. */
export async function createHook(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof hookInput>) {
  const input = hookInput.parse(raw);
  // Provider presets verify with the provider's signing secret; Realy's own modes get a random secret shown once.
  const preset = isProviderPreset(input.verification);
  const secret = preset ? input.signingSecret! : randomToken(32);
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const created = await tx.integrationHook.create({
      data: { organizationId, companyId, name: input.name, verification: input.verification, signatureHeader: input.signatureHeader, secretEnc: "pending", createdById: ctx.actor.id ?? organizationId },
      select: { id: true },
    });
    const hook = await tx.integrationHook.update({ where: { id: created.id }, data: { secretEnc: encryptSecret(secret, hookPurpose(created.id)) }, select: hookSelect });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.hook_created", resourceType: "integration_hook", resourceId: hook.id, newValue: { name: hook.name, verification: hook.verification } });
    return { hook: { ...hook, url: hookUrl(hook.id) }, secret: preset ? null : secret };
  });
}

async function findHook(organizationId: string, companyId: string, hookId: string) {
  if (!isUuid(hookId)) throw notFound("Webhook");
  const hook = await db().integrationHook.findFirst({ where: { id: hookId, organizationId, companyId }, select: hookSelect });
  if (!hook) throw notFound("Webhook");
  return hook;
}

export async function updateHook(ctx: RequestContext, organizationId: string, companyId: string, hookId: string, raw: z.input<typeof hookUpdateInput>) {
  const input = hookUpdateInput.parse(raw);
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const before = await findHook(organizationId, companyId, hookId);
    const { signingSecret, ...fields } = input;
    const verification = fields.verification ?? before.verification;
    if (isProviderPreset(verification) && verification !== before.verification && !signingSecret) throw invalid("Enter the signing secret the provider shows for this webhook", { reason: "signing_secret_required" });
    const hook = await tx.integrationHook.update({
      where: { id: hookId },
      data: { ...fields, ...(signingSecret && isProviderPreset(verification) ? { secretEnc: encryptSecret(signingSecret, hookPurpose(hookId)) } : {}) },
      select: hookSelect,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.hook_updated", resourceType: "integration_hook", resourceId: hookId, oldValue: before, newValue: { ...fields, ...(signingSecret ? { signingSecret: "updated" } : {}) } });
    return hook;
  });
}

export async function rotateHookSecret(ctx: RequestContext, organizationId: string, companyId: string, hookId: string) {
  const secret = randomToken(32);
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const hook = await findHook(organizationId, companyId, hookId);
    // The provider owns a preset's secret: rotate it there, then save the new one with updateHook.
    if (isProviderPreset(hook.verification)) throw invalid("Rotate the signing secret at the provider, then save the new secret here", { reason: "provider_managed_secret" });
    await tx.integrationHook.update({ where: { id: hookId }, data: { secretEnc: encryptSecret(secret, hookPurpose(hookId)) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.hook_secret_rotated", resourceType: "integration_hook", resourceId: hookId });
    return { secret };
  });
}

export async function deleteHook(ctx: RequestContext, organizationId: string, companyId: string, hookId: string) {
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const hook = await findHook(organizationId, companyId, hookId);
    await tx.integrationHook.delete({ where: { id: hookId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.hook_deleted", resourceType: "integration_hook", resourceId: hookId, oldValue: { name: hook.name } });
    return { ok: true };
  });
}

export async function getHookWithDeliveries(ctx: RequestContext, organizationId: string, companyId: string, hookId: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.read");
  const hook = await findHook(organizationId, companyId, hookId);
  const deliveries = await db().integrationHookDelivery.findMany({ where: { hookId, companyId }, orderBy: { receivedAt: "desc" }, take: 100 });
  return { hook: { ...hook, url: hookUrl(hook.id) }, deliveries };
}

const MAX_HOOK_BODY = 256 * 1024;
const HOOK_LIMIT = { name: "integration-hook", limit: 120, windowMs: 60_000 };

type Scalar = string | number | boolean | null;

/** Top-level scalar fields of a JSON body (what workflow conditions can test as event.data.<field>). */
function flatten(body: unknown): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return out;
  for (const [k, v] of Object.entries(body as Record<string, unknown>).slice(0, 50)) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(k) || ["hookId", "hookName", "deliveryId"].includes(k)) continue;
    if (v === null || typeof v === "boolean" || typeof v === "number") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 1000);
  }
  return out;
}

export interface HookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Receive one incoming webhook delivery (POST /api/v1/hooks/{hookId}). Authenticity: the secret token (header
 * `x-realy-token`, `authorization: Bearer`, or `?token=`) or an HMAC-SHA256 hex signature of the raw body in the hook's
 * signature header ("sha256=" prefix allowed). Accepted deliveries are stored and emitted as `webhook.received`.
 */
export async function receiveHook(hookId: string, raw: string, headers: Headers, query: URLSearchParams, ip: string | null): Promise<HookResult> {
  if (!isUuid(hookId)) return { status: 404, body: { error: "not_found" } };
  const hook = await db().integrationHook.findUnique({ where: { id: hookId } });
  if (!hook || !hook.active) return { status: 404, body: { error: "not_found" } };
  const limit = await consume(HOOK_LIMIT, hookId);
  if (!limit.allowed) return { status: 429, body: { error: "rate_limited" } };
  if (Buffer.byteLength(raw) > MAX_HOOK_BODY) return { status: 413, body: { error: "payload_too_large" } };

  const secret = decryptSecret(hook.secretEnc, hookPurpose(hook.id));
  const check = verifyHookSignature({ verification: hook.verification, secret, raw, headers, query, signatureHeader: hook.signatureHeader });
  const contentType = headers.get("content-type")?.slice(0, 100) ?? null;
  if (!check.ok) {
    await db().integrationHookDelivery.create({ data: { organizationId: hook.organizationId, companyId: hook.companyId, hookId: hook.id, status: "REJECTED", contentType, error: check.reason.slice(0, 200), ip } });
    return { status: 401, body: { error: "unauthenticated" } };
  }
  let parsed: unknown = null;
  if (contentType?.includes("json") || raw.trim().startsWith("{")) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  } else if (contentType?.includes("application/x-www-form-urlencoded")) {
    parsed = Object.fromEntries(new URLSearchParams(raw));
  }
  const ctx = systemContext(headers.get("x-request-id") ?? undefined);
  const result = await transaction(async (tx) => {
    const delivery = await tx.integrationHookDelivery.create({
      data: { organizationId: hook.organizationId, companyId: hook.companyId, hookId: hook.id, status: "ACCEPTED", body: raw.slice(0, 16_000), contentType, ip },
      select: { id: true },
    });
    const eventId = await emitDomainEvent(tx, ctx, "webhook.received", {
      organizationId: hook.organizationId,
      companyId: hook.companyId,
      entityType: "integration_hook_delivery",
      entityId: delivery.id,
      data: { ...flatten(parsed), hookId: hook.id, hookName: hook.name, deliveryId: delivery.id },
    });
    await tx.integrationHookDelivery.update({ where: { id: delivery.id }, data: { eventId } });
    await tx.integrationHook.update({ where: { id: hook.id }, data: { lastReceivedAt: new Date() } });
    return { deliveryId: delivery.id };
  });
  return { status: 202, body: { ok: true, deliveryId: result.deliveryId } };
}

// ───────────────────────────── Outbound webhooks ─────────────────────────────

export const OUTBOUND_EVENT_TYPES = DOMAIN_EVENTS.filter((t) => t !== "schedule.tick");

const eventTypes = z
  .array(z.string())
  .min(1)
  .max(50)
  .refine((a) => a.every((t) => t === "*" || (OUTBOUND_EVENT_TYPES as readonly string[]).includes(t)), "Unknown event type");

export const subscriptionInput = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(2000),
  eventTypes,
});
export const subscriptionUpdateInput = subscriptionInput.partial().extend({ active: z.boolean().optional() });

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
function isPrivateAddress(addr: string): boolean {
  if (isIP(addr) === 4) return PRIVATE_V4.some((r) => r.test(addr));
  const a = addr.toLowerCase();
  return a === "::1" || a === "::" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80") || a.startsWith("::ffff:127.") || a.startsWith("::ffff:10.") || a.startsWith("::ffff:192.168.");
}

/** Outbound targets must be public HTTPS endpoints (HTTP is allowed outside production for local testing). */
export function validateTargetUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid("Invalid URL", { reason: "integrations_url_invalid" });
  }
  const prod = env().NODE_ENV === "production";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !prod)) throw invalid("The URL must use HTTPS", { reason: "integrations_url_invalid" });
  if (url.username || url.password) throw invalid("Credentials in URLs are not allowed", { reason: "integrations_url_invalid" });
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (prod && (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || (isIP(host) && isPrivateAddress(host)))) {
    throw invalid("Private network addresses are not allowed", { reason: "integrations_url_invalid" });
  }
  return url;
}

/** At send time: the resolved address must be public too (DNS rebinding protection), in production. */
async function assertPublicTarget(url: URL) {
  if (env().NODE_ENV !== "production") return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error("target resolves to a private address");
}

const subSelect = { id: true, name: true, url: true, eventTypes: true, active: true, createdAt: true, updatedAt: true } satisfies Prisma.IntegrationWebhookSubscriptionSelect;

export async function listSubscriptions(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.read");
  const subs = await db().integrationWebhookSubscription.findMany({ where: { organizationId, companyId }, orderBy: { createdAt: "desc" }, select: subSelect });
  const failing = await db().integrationWebhookDelivery.groupBy({ by: ["subscriptionId"], where: { companyId, status: "FAILED" }, _count: { _all: true } });
  const failed = new Map(failing.map((f) => [f.subscriptionId, f._count._all]));
  return subs.map((s) => ({ ...s, failedDeliveries: failed.get(s.id) ?? 0 }));
}

export async function createSubscription(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof subscriptionInput>) {
  const input = subscriptionInput.parse(raw);
  validateTargetUrl(input.url);
  const secret = `whsec_${randomToken(32)}`;
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const count = await tx.integrationWebhookSubscription.count({ where: { companyId } });
    if (count >= 25) throw conflict("Too many webhook subscriptions", { reason: "integrations_webhook_limit" });
    const created = await tx.integrationWebhookSubscription.create({
      data: { organizationId, companyId, name: input.name, url: input.url, eventTypes: input.eventTypes.includes("*") ? ["*"] : [...new Set(input.eventTypes)], secretEnc: "pending", createdById: ctx.actor.id ?? organizationId },
      select: { id: true },
    });
    const sub = await tx.integrationWebhookSubscription.update({ where: { id: created.id }, data: { secretEnc: encryptSecret(secret, subPurpose(created.id)) }, select: subSelect });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.webhook_created", resourceType: "integration_webhook", resourceId: sub.id, newValue: { name: sub.name, url: sub.url, eventTypes: sub.eventTypes } });
    return { subscription: sub, secret };
  });
}

async function findSubscription(organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Webhook");
  const sub = await db().integrationWebhookSubscription.findFirst({ where: { id, organizationId, companyId }, select: subSelect });
  if (!sub) throw notFound("Webhook");
  return sub;
}

export async function updateSubscription(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof subscriptionUpdateInput>) {
  const input = subscriptionUpdateInput.parse(raw);
  if (input.url) validateTargetUrl(input.url);
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const before = await findSubscription(organizationId, companyId, id);
    const sub = await tx.integrationWebhookSubscription.update({
      where: { id },
      data: { ...input, ...(input.eventTypes ? { eventTypes: input.eventTypes.includes("*") ? ["*"] : [...new Set(input.eventTypes)] } : {}) },
      select: subSelect,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.webhook_updated", resourceType: "integration_webhook", resourceId: id, oldValue: before, newValue: input });
    return sub;
  });
}

export async function rotateSubscriptionSecret(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  const secret = `whsec_${randomToken(32)}`;
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    await findSubscription(organizationId, companyId, id);
    await tx.integrationWebhookSubscription.update({ where: { id }, data: { secretEnc: encryptSecret(secret, subPurpose(id)) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.webhook_secret_rotated", resourceType: "integration_webhook", resourceId: id });
    return { secret };
  });
}

export async function deleteSubscription(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const sub = await findSubscription(organizationId, companyId, id);
    await tx.integrationWebhookSubscription.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.webhook_deleted", resourceType: "integration_webhook", resourceId: id, oldValue: { name: sub.name, url: sub.url } });
    return { ok: true };
  });
}

export async function getSubscriptionWithDeliveries(ctx: RequestContext, organizationId: string, companyId: string, id: string, status?: string) {
  await authorizeIntegrations(ctx, organizationId, companyId, "integrations.read");
  const subscription = await findSubscription(organizationId, companyId, id);
  const st = ["PENDING", "SUCCEEDED", "FAILED"].includes(status ?? "") ? (status as "FAILED") : undefined;
  const deliveries = await db().integrationWebhookDelivery.findMany({ where: { subscriptionId: id, companyId, ...(st ? { status: st } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
  return { subscription, deliveries };
}

/** Send a delivery again now (any status). */
export async function redeliver(ctx: RequestContext, organizationId: string, companyId: string, deliveryId: string) {
  if (!isUuid(deliveryId)) throw notFound("Delivery");
  await transaction(async (tx) => {
    await authorizeIntegrations(ctx, organizationId, companyId, "integrations.manage", tx);
    const d = await tx.integrationWebhookDelivery.findFirst({ where: { id: deliveryId, organizationId, companyId }, select: { id: true, status: true } });
    if (!d) throw notFound("Delivery");
    await tx.integrationWebhookDelivery.update({ where: { id: d.id }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "integration.webhook_redelivered", resourceType: "integration_webhook_delivery", resourceId: d.id, oldValue: { status: d.status } });
  });
  return attemptDelivery(deliveryId);
}

/** Retry schedule after attempt n (1-based): 1 min, 5 min, 30 min, 2 h, 6 h; then FAILED. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000];
export const MAX_DELIVERY_ATTEMPTS = BACKOFF_MS.length + 1;

/** Signature header: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")> (verify by recomputing; reject old timestamps). */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${hmacSha256(secret, `${timestamp}.${body}`).toString("hex")}`;
}

/** POST one delivery; on failure schedule a retry with backoff or mark it FAILED. */
export async function attemptDelivery(deliveryId: string) {
  const d = await db().integrationWebhookDelivery.findUnique({ where: { id: deliveryId }, include: { subscription: { select: { id: true, url: true, secretEnc: true, active: true } } } });
  if (!d || d.status !== "PENDING") return d ? { status: d.status } : null;
  const attempts = d.attempts + 1;
  // Claim the attempt: concurrent workers never both send it.
  const claimed = await db().integrationWebhookDelivery.updateMany({ where: { id: d.id, status: "PENDING", attempts: d.attempts }, data: { attempts, nextAttemptAt: new Date(Date.now() + 5 * 60_000) } });
  if (!claimed.count) return { status: "PENDING" };
  const body = JSON.stringify(d.payload);
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const url = validateTargetUrl(d.subscription.url);
    await assertPublicTarget(url);
    const secret = decryptSecret(d.subscription.secretEnc, subPurpose(d.subscription.id));
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Realy-Webhooks/1", "x-realy-event": d.eventType, "x-realy-delivery": d.id, "x-realy-signature": signPayload(secret, body) },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    statusCode = res.status;
    await res.body?.cancel().catch(() => undefined);
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 300) : "delivery failed";
  }
  if (!error) {
    await db().integrationWebhookDelivery.update({ where: { id: d.id }, data: { status: "SUCCEEDED", lastStatusCode: statusCode, lastError: null, deliveredAt: new Date(), nextAttemptAt: null } });
    return { status: "SUCCEEDED", statusCode };
  }
  const final = attempts >= MAX_DELIVERY_ATTEMPTS;
  await db().integrationWebhookDelivery.update({
    where: { id: d.id },
    data: { status: final ? "FAILED" : "PENDING", lastStatusCode: statusCode, lastError: error, nextAttemptAt: final ? null : new Date(Date.now() + BACKOFF_MS[attempts - 1]!) },
  });
  if (final) logger.warn({ deliveryId: d.id, subscriptionId: d.subscriptionId }, "webhook delivery failed permanently");
  return { status: final ? "FAILED" : "PENDING", statusCode, error };
}

/** Event handler: fan a domain event out to matching subscriptions (deduplicated per subscription and event). */
export async function fanOutEvent(event: OutboxEvent) {
  if (!event.companyId || !event.organizationId || !(OUTBOUND_EVENT_TYPES as readonly string[]).includes(event.type)) return 0;
  const subs = await db().integrationWebhookSubscription.findMany({
    where: { organizationId: event.organizationId, companyId: event.companyId, active: true, OR: [{ eventTypes: { has: event.type } }, { eventTypes: { has: "*" } }] },
    select: { id: true },
  });
  if (!subs.length) return 0;
  const p = (event.payload ?? {}) as { entityId?: string; data?: Record<string, unknown> };
  const payload = { id: event.id, type: event.type, occurredAt: event.occurredAt.toISOString(), companyId: event.companyId, entityType: event.aggregateType, entityId: p.entityId ?? event.aggregateId, data: p.data ?? {} };
  await db().integrationWebhookDelivery.createMany({
    data: subs.map((s) => ({ organizationId: event.organizationId!, companyId: event.companyId!, subscriptionId: s.id, eventId: event.id, eventType: event.type, payload: toJson(payload), nextAttemptAt: new Date() })),
    skipDuplicates: true,
  });
  const created = await db().integrationWebhookDelivery.findMany({ where: { eventId: event.id, status: "PENDING", attempts: 0, subscriptionId: { in: subs.map((s) => s.id) } }, select: { id: true, attempts: true } });
  for (const c of created) await sendDelivery(c, event.organizationId);
  return created.length;
}

/**
 * Send a delivery on the worker's webhooks queue (parallel, isolated from the event handlers) or, without the worker
 * queues, inline. The job id carries the attempt number, so a delivery is queued once per attempt; the attempt claim in
 * attemptDelivery keeps concurrent sends impossible either way.
 */
async function sendDelivery(d: { id: string; attempts: number }, organizationId: string | null) {
  const queued = await dispatchJob(WEBHOOKS_QUEUE, "integrations.webhook_delivery", { deliveryId: d.id }, { jobId: `whd_${d.id}_${d.attempts}`, organizationId });
  if (!queued) await attemptDelivery(d.id);
}

/** Periodic job: retry deliveries whose backoff has elapsed. */
export async function retryDueDeliveries(limit = 50): Promise<number> {
  const due = await db().integrationWebhookDelivery.findMany({ where: { status: "PENDING", nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: "asc" }, take: limit, select: { id: true, attempts: true, organizationId: true } });
  for (const d of due) await sendDelivery(d, d.organizationId);
  return due.length;
}
