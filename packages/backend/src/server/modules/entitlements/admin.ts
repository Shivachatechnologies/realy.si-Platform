/**
 * Control Center: plan & entitlement manager (apps/admin (console)/plans). Plan/price/promotion edits reuse
 * pricing/service.ts (new PriceVersion per change, history never rewritten); this file adds per-organization
 * overrides, admin add-on grants, subscription management for an organization, and the revenue/churn summary.
 * Every write needs a reason and is audited.
 */
import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { requireAnyPlatform, reasonSchema } from "@/server/modules/admin/access";
import {
  ADDONS,
  FEATURE_KEYS,
  LIMIT_KEYS,
  PLAN_KEYS,
  catalogPlanOf,
  invalidateEntitlements,
  isAddonKey,
  isFeatureKey,
  isHighCostLimit,
  isLimitKey,
  monthlyWindow,
  planTable,
  usageSummary,
  type AddonKey,
} from "./service";
import { meterOfLimit, writeLedgerEntry } from "./ledger";
import { LIMITS } from "./catalog";

const READ = ["platform.subscriptions.read", "pricing.read"];
const MANAGE = ["platform.subscriptions.manage", "pricing.manage"];

// ───────────── Overview: plans + revenue & churn ─────────────

const DAY = 86_400_000;

/** MRR per plan and currency (annual / 12), live subscriptions, trials, cancellations scheduled, churn (30 days). */
export async function planRevenueSummary(ctx: RequestContext) {
  await requireAnyPlatform(ctx, READ);
  const since = new Date(Date.now() - 30 * DAY);
  const [subs, canceled30, startLive, plans] = await Promise.all([
    db().subscription.findMany({
      where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
      select: { status: true, interval: true, cancelAtPeriodEnd: true, plan: { select: { key: true } }, items: { select: { unitAmountMinor: true, quantity: true, currency: true } } },
    }),
    db().subscription.findMany({ where: { canceledAt: { gte: since } }, select: { plan: { select: { key: true } } } }),
    db().subscription.count({ where: { createdAt: { lt: since }, OR: [{ canceledAt: null }, { canceledAt: { gte: since } }] } }),
    planTable(),
  ]);
  const byPlan = new Map<string, { live: number; trialing: number; pastDue: number; cancelScheduled: number; churned30: number; mrr: Record<string, bigint> }>();
  const row = (k: string) => {
    if (!byPlan.has(k)) byPlan.set(k, { live: 0, trialing: 0, pastDue: 0, cancelScheduled: 0, churned30: 0, mrr: {} });
    return byPlan.get(k)!;
  };
  for (const s of subs) {
    const r = row(s.plan.key);
    r.live += 1;
    if (s.status === "TRIALING") r.trialing += 1;
    if (s.status === "PAST_DUE") r.pastDue += 1;
    if (s.cancelAtPeriodEnd) r.cancelScheduled += 1;
    for (const i of s.items) {
      const monthly = (i.unitAmountMinor * BigInt(i.quantity)) / (s.interval === "YEAR" ? 12n : 1n);
      r.mrr[i.currency] = (r.mrr[i.currency] ?? 0n) + monthly;
    }
  }
  for (const c of canceled30) row(c.plan.key).churned30 += 1;
  const churnRate = startLive > 0 ? canceled30.length / startLive : null;
  return {
    plans: plans.map((p) => ({ key: p.key, name: p.name, planId: p.planId, ...(byPlan.get(p.key) ?? row(p.key)) })),
    others: [...byPlan.entries()].filter(([k]) => !(PLAN_KEYS as readonly string[]).includes(k)).map(([key, v]) => ({ key, catalogPlan: catalogPlanOf(key), ...v })),
    churn30: { canceled: canceled30.length, base: startLive, rate: churnRate },
  };
}

// ───────────── Organization view ─────────────

export async function organizationEntitlements(ctx: RequestContext, organizationId: string) {
  await requireAnyPlatform(ctx, READ);
  const org = await db().organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, slug: true, createdAt: true } });
  if (!org) throw notFound("Organization");
  const [summary, overrides, addons] = await Promise.all([
    usageSummary(organizationId),
    db().entitlementOverride.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100 }),
    db().entitlementAddonPurchase.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return { org, summary, overrides, addons };
}

/** Organizations by name/slug for the override picker. */
export async function searchOrganizations(ctx: RequestContext, q: string) {
  await requireAnyPlatform(ctx, READ);
  const term = q.trim().slice(0, 100);
  if (!term) return [];
  const isId = /^[0-9a-f-]{36}$/.test(term);
  return db().organization.findMany({
    where: isId ? { id: term } : { OR: [{ name: { contains: term, mode: "insensitive" } }, { slug: { contains: term, mode: "insensitive" } }] },
    select: { id: true, name: true, slug: true },
    take: 20,
  });
}

// ───────────── Overrides ─────────────

export const overrideInput = z.object({
  organizationId: z.string().uuid(),
  key: z.string().max(80),
  enabled: z.boolean().default(true),
  limitValue: z.union([z.string().regex(/^\d{1,15}$/), z.number().int().nonnegative()]).transform((v) => BigInt(v)).nullable().optional(),
  expiresAt: z.coerce.date().optional(),
  reason: reasonSchema,
});

export async function grantOverride(ctx: RequestContext, raw: z.input<typeof overrideInput>) {
  const input = overrideInput.parse(raw);
  if (!isFeatureKey(input.key) && !isLimitKey(input.key)) throw invalid("Unknown entitlement key", { field: "key" });
  if (isLimitKey(input.key) && input.enabled && (input.limitValue ?? null) === null && isHighCostLimit(input.key)) {
    throw invalid("High-cost usage needs a finite quota", { reason: "plan_limit_unlimited_high_cost", field: "limitValue" });
  }
  if (input.expiresAt && input.expiresAt <= new Date()) throw invalid("Expiry must be in the future", { field: "expiresAt" });
  const row = await transaction(async (tx) => {
    await requireAnyPlatform(ctx, MANAGE);
    if (!(await tx.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } }))) throw notFound("Organization");
    // One active override per key: the previous one is revoked (kept for history).
    const previous = await tx.entitlementOverride.findMany({ where: { organizationId: input.organizationId, key: input.key, revokedAt: null } });
    if (previous.length) await tx.entitlementOverride.updateMany({ where: { id: { in: previous.map((p) => p.id) } }, data: { revokedAt: new Date(), revokedById: ctx.actor.id } });
    const created = await tx.entitlementOverride.create({
      data: {
        organizationId: input.organizationId,
        key: input.key,
        enabled: input.enabled,
        limitValue: isLimitKey(input.key) ? (input.limitValue ?? null) : null,
        reason: input.reason,
        expiresAt: input.expiresAt ?? null,
        createdById: ctx.actor.id,
      },
    });
    await writeAudit(tx, ctx, {
      category: "ADMIN",
      organizationId: input.organizationId,
      action: "entitlements.override.granted",
      resourceType: "entitlement_override",
      resourceId: created.id,
      oldValue: previous.length ? previous : null,
      newValue: created,
      reason: input.reason,
    });
    return created;
  });
  invalidateEntitlements(input.organizationId);
  return row;
}

export async function revokeOverride(ctx: RequestContext, overrideId: string, reason: string) {
  const why = reasonSchema.parse(reason);
  const row = await transaction(async (tx) => {
    await requireAnyPlatform(ctx, MANAGE);
    const o = await tx.entitlementOverride.findUnique({ where: { id: overrideId } });
    if (!o) throw notFound("Override");
    if (o.revokedAt) return o;
    const updated = await tx.entitlementOverride.update({ where: { id: o.id }, data: { revokedAt: new Date(), revokedById: ctx.actor.id } });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: o.organizationId, action: "entitlements.override.revoked", resourceType: "entitlement_override", resourceId: o.id, oldValue: o, newValue: updated, reason: why });
    return updated;
  });
  invalidateEntitlements(row.organizationId);
  return row;
}

// ───────────── Internal accounts: unlock everything ─────────────

export const unlockAllInput = z.object({
  organizationId: z.string().uuid(),
  /** Trial end for organizations without a subscription, so usage keeps working (default 10 years). */
  trialYears: z.number().int().min(1).max(10).default(10),
  reason: reasonSchema,
});

/**
 * Internal / owner accounts: one override per feature (enabled) and per limit (the Scale plan value; high-cost
 * limits always stay finite), plus a long trial window when there is no subscription. Previous active overrides are
 * revoked (kept for history). One audit entry with every key granted.
 */
export async function unlockAllEntitlements(ctx: RequestContext, raw: z.input<typeof unlockAllInput>) {
  const input = unlockAllInput.parse(raw);
  const now = new Date();
  const result = await transaction(async (tx) => {
    await requireAnyPlatform(ctx, MANAGE);
    if (!(await tx.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } }))) throw notFound("Organization");
    const keys = [...FEATURE_KEYS, ...LIMIT_KEYS] as string[];
    await tx.entitlementOverride.updateMany({
      where: { organizationId: input.organizationId, key: { in: keys }, revokedAt: null },
      data: { revokedAt: now, revokedById: ctx.actor.id },
    });
    const limitValue = (k: (typeof LIMIT_KEYS)[number]) => {
      const v = LIMITS[k].values.scale;
      if (v === null) return isHighCostLimit(k) ? 0n : null;
      return BigInt(v);
    };
    const data = [
      ...FEATURE_KEYS.map((key) => ({ organizationId: input.organizationId, key, enabled: true, limitValue: null, reason: input.reason, createdById: ctx.actor.id })),
      ...LIMIT_KEYS.map((key) => ({ organizationId: input.organizationId, key, enabled: true, limitValue: limitValue(key), reason: input.reason, createdById: ctx.actor.id })),
    ];
    await tx.entitlementOverride.createMany({ data });
    const subscribed = await tx.subscription.count({ where: { organizationId: input.organizationId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } } }).catch(() => 0);
    let trialEndsAt: Date | null = null;
    if (!subscribed) {
      trialEndsAt = new Date(now.getTime() + input.trialYears * 365 * 86_400_000);
      await tx.entitlementTrial.upsert({
        where: { organizationId: input.organizationId },
        create: { organizationId: input.organizationId, startedAt: now, endsAt: trialEndsAt, source: "manual" },
        update: { endsAt: trialEndsAt, source: "manual" },
      });
    }
    await writeAudit(tx, ctx, {
      category: "ADMIN",
      organizationId: input.organizationId,
      action: "entitlements.internal_unlock",
      resourceType: "organization",
      resourceId: input.organizationId,
      newValue: { features: FEATURE_KEYS.length, limits: LIMIT_KEYS.length, trialEndsAt },
      reason: input.reason,
    });
    return { features: FEATURE_KEYS.length, limits: LIMIT_KEYS.length, trialEndsAt };
  });
  invalidateEntitlements(input.organizationId);
  return result;
}

// ───────────── Admin add-on grants (credit allocation for one organization) ─────────────

export const addonGrantInput = z.object({ organizationId: z.string().uuid(), addonKey: z.string().max(60), packs: z.number().int().min(1).max(100), reason: reasonSchema });

/** Grant add-on packs without payment (goodwill, pilots) for the organization's current usage window. */
export async function grantAddon(ctx: RequestContext, raw: z.input<typeof addonGrantInput>) {
  const input = addonGrantInput.parse(raw);
  if (!isAddonKey(input.addonKey)) throw invalid("Unknown add-on", { field: "addonKey" });
  const addon = ADDONS[input.addonKey as AddonKey];
  const row = await transaction(async (tx) => {
    await requireAnyPlatform(ctx, MANAGE);
    if (!(await tx.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } }))) throw notFound("Organization");
    const sub = await tx.subscription.findFirst({ where: { organizationId: input.organizationId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, orderBy: { createdAt: "desc" }, select: { currentPeriodStart: true } });
    const window = monthlyWindow(sub?.currentPeriodStart ?? null);
    const created = await tx.entitlementAddonPurchase.create({
      data: {
        organizationId: input.organizationId,
        addonKey: input.addonKey,
        limitKey: addon.limit,
        packs: input.packs,
        quantity: BigInt(addon.quantity * input.packs),
        status: "PAID",
        source: "admin",
        reason: input.reason,
        createdById: ctx.actor.id,
        paidAt: new Date(),
        windowStart: window.start,
        windowEnd: window.end,
      },
    });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: input.organizationId, action: "entitlements.addon.granted", resourceType: "addon_purchase", resourceId: created.id, newValue: created, reason: input.reason });
    const meter = meterOfLimit(addon.limit);
    if (meter) {
      await writeLedgerEntry(tx, { organizationId: input.organizationId, meter, kind: "GRANT", delta: created.quantity, period: window, sourceType: "addon_purchase", sourceId: created.id, reason: input.reason, actorId: ctx.actor.id ?? null });
    }
    return created;
  });
  invalidateEntitlements(input.organizationId);
  return row;
}

// ───────────── Subscription management (upgrade / downgrade / cancellation) ─────────────

export const adminPlanChangeInput = z.object({ planKey: z.string().min(1).max(41), interval: z.enum(["MONTH", "YEAR"]), reason: reasonSchema });

export async function adminChangePlan(ctx: RequestContext, organizationId: string, raw: z.input<typeof adminPlanChangeInput>) {
  const input = adminPlanChangeInput.parse(raw);
  await requireAnyPlatform(ctx, ["platform.subscriptions.manage"]);
  const { changeSubscriptionPlan } = await import("@/server/modules/billing/stripe-billing");
  return changeSubscriptionPlan(ctx, organizationId, { planKey: input.planKey, interval: input.interval }, { asPlatform: true, reason: input.reason });
}

export const adminCancelInput = z.object({ cancel: z.boolean(), reason: reasonSchema });

export async function adminSetCancellation(ctx: RequestContext, organizationId: string, raw: z.input<typeof adminCancelInput>) {
  const input = adminCancelInput.parse(raw);
  await requireAnyPlatform(ctx, ["platform.subscriptions.manage"]);
  const { setSubscriptionCancellation } = await import("@/server/modules/billing/stripe-billing");
  return setSubscriptionCancellation(ctx, organizationId, input.cancel, { asPlatform: true, reason: input.reason });
}

/** Keys an override may target, for the admin form. */
export const overrideKeys = () => ({ features: FEATURE_KEYS, limits: LIMIT_KEYS });
