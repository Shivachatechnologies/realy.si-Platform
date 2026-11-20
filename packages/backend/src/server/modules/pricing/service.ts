import { z } from "zod";
import type { BillingInterval, MarketType } from "@/generated/prisma/enums";
import { db, transaction, type Tx, type Db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { money, type Money } from "@/server/core/money";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { loadGrants, requirePermission } from "@/server/modules/rbac/service";
import { marketChain, platformChain, type ScopeChain } from "@/server/modules/rbac/scope";

// ───────────── Resolution (public, read-only) ─────────────

export interface ResolvedPrice {
  plan: { id: string; key: string; name: string; defaultTrialDays: number };
  priceId: string;
  priceVersionId: string;
  version: number;
  market: { type: MarketType; code: string };
  interval: BillingInterval;
  money: Money;
  trialDays: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export type Resolution =
  | { available: true; price: ResolvedPrice }
  | { available: false; reason: "plan_inactive" | "country_unavailable" | "no_price_for_market" };

/**
 * Resolve the price of a plan for a billing country at an instant (docs/billing.md §2):
 * COUNTRY → REGION → GLOBAL, first market with a version effective at `at` wins.
 * Never silently falls back to another currency outside that order.
 */
export async function resolvePrice(
  client: Tx | Db,
  args: { planKey: string; interval: BillingInterval; countryCode: string; at?: Date },
): Promise<Resolution> {
  const at = args.at ?? new Date();
  const plan = await client.plan.findUnique({ where: { key: args.planKey } });
  if (!plan || plan.status !== "ACTIVE") return { available: false, reason: "plan_inactive" };
  const country = await client.country.findUnique({ where: { code: args.countryCode } });
  if (!country || country.status !== "ACTIVE" || !country.billingEnabled) return { available: false, reason: "country_unavailable" };

  const markets: { type: MarketType; code: string }[] = [
    { type: "COUNTRY", code: country.code },
    { type: "REGION", code: country.regionCode },
    { type: "GLOBAL", code: "*" },
  ];
  const prices = await client.price.findMany({
    where: {
      planId: plan.id,
      interval: args.interval,
      status: "ACTIVE",
      OR: markets.map((m) => ({ marketType: m.type, marketCode: m.code })),
    },
    include: {
      versions: {
        where: { effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
        take: 1,
      },
    },
  });
  for (const m of markets) {
    const price = prices.find((p) => p.marketType === m.type && p.marketCode === m.code);
    const v = price?.versions[0];
    if (price && v) {
      return {
        available: true,
        price: {
          plan: { id: plan.id, key: plan.key, name: plan.name, defaultTrialDays: plan.defaultTrialDays },
          priceId: price.id,
          priceVersionId: v.id,
          version: v.version,
          market: m,
          interval: price.interval,
          money: money(v.amountMinor, v.currency),
          trialDays: v.trialDays ?? plan.defaultTrialDays,
          effectiveFrom: v.effectiveFrom,
          effectiveTo: v.effectiveTo,
        },
      };
    }
  }
  return { available: false, reason: "no_price_for_market" };
}

/** Public pricing page data for a billing country. */
export async function getPublicPricing(countryCode: string, interval: BillingInterval, at = new Date()) {
  const plans = await db().plan.findMany({
    where: { status: "ACTIVE", public: true },
    orderBy: { sortOrder: "asc" },
    include: { entitlements: true },
  });
  return Promise.all(
    plans.map(async (p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      entitlements: p.entitlements.map((e) => ({ featureKey: e.featureKey, enabled: e.enabled, limitValue: e.limitValue })),
      resolution: await resolvePrice(db(), { planKey: p.key, interval, countryCode, at }),
    })),
  );
}

// ───────────── Administration ─────────────

/** Read access to the catalog for anyone holding pricing.read at any platform/region/country scope. */
export async function requireCatalogReader(ctx: RequestContext): Promise<void> {
  if (ctx.actor.type === "SYSTEM") return;
  if (!ctx.actor.id) throw forbidden("Missing permission pricing.read");
  const grants = await loadGrants(db(), ctx.actor.type as "USER", ctx.actor.id);
  if (!grants.some((g) => g.permissions.has("pricing.read"))) throw forbidden("Missing permission pricing.read", { permission: "pricing.read" });
}

/** Markets the actor may manage (for UI hints only; every write re-checks). */
export async function manageableMarkets(ctx: RequestContext) {
  if (ctx.actor.type === "SYSTEM") return { platform: true, regions: [] as string[], countries: [] as string[] };
  const grants = await loadGrants(db(), ctx.actor.type as "USER", ctx.actor.id!);
  const g = grants.filter((x) => x.permissions.has("pricing.manage"));
  return {
    platform: g.some((x) => x.scopeType === "PLATFORM"),
    regions: g.filter((x) => x.scopeType === "REGION").map((x) => x.scopeId),
    countries: g.filter((x) => x.scopeType === "COUNTRY").map((x) => x.scopeId),
  };
}

export async function listCatalog(ctx: RequestContext) {
  await requireCatalogReader(ctx);
  return db().plan.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      entitlements: { orderBy: { featureKey: "asc" } },
      prices: {
        orderBy: [{ marketType: "asc" }, { marketCode: "asc" }, { interval: "asc" }],
        include: { versions: { orderBy: { version: "desc" } } },
      },
    },
  });
}

const planKey = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);

export const createPlanInput = z.object({
  key: planKey,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  productKey: z.string().default("realy-platform"),
  public: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
  defaultTrialDays: z.number().int().min(0).max(365).default(0),
});

export async function createPlan(ctx: RequestContext, raw: z.input<typeof createPlanInput>) {
  const input = createPlanInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "pricing.manage", platformChain(), tx);
    const product = await tx.billingProduct.findUnique({ where: { key: input.productKey } });
    if (!product) throw notFound("Billing product");
    if (await tx.plan.findUnique({ where: { key: input.key } })) throw conflict(`Plan ${input.key} already exists`);
    const plan = await tx.plan.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description,
        productId: product.id,
        public: input.public,
        sortOrder: input.sortOrder,
        defaultTrialDays: input.defaultTrialDays,
        status: "DRAFT",
      },
    });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "pricing.plan.created", resourceType: "plan", resourceId: plan.id, newValue: plan });
    await emitEvent(tx, ctx, "pricing.plan.created", { planId: plan.id, key: plan.key }, { aggregateType: "plan", aggregateId: plan.id });
    return plan;
  });
}

export const updatePlanInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "DISABLED"]).optional(),
  public: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  defaultTrialDays: z.number().int().min(0).max(365).optional(),
  reason: z.string().trim().min(3).max(500),
});

export async function updatePlan(ctx: RequestContext, planId: string, raw: z.input<typeof updatePlanInput>) {
  const { reason, ...patch } = updatePlanInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "pricing.manage", platformChain(), tx);
    const before = await tx.plan.findUnique({ where: { id: planId } });
    if (!before) throw notFound("Plan");
    const after = await tx.plan.update({ where: { id: planId }, data: patch });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "pricing.plan.updated", resourceType: "plan", resourceId: planId, oldValue: before, newValue: after, reason });
    await emitEvent(tx, ctx, "pricing.plan.updated", { planId, key: after.key }, { aggregateType: "plan", aggregateId: planId });
    return after;
  });
}

const amountMinor = z.union([z.string().regex(/^\d{1,15}$/), z.number().int().nonnegative(), z.bigint().nonnegative()]).transform((v) => BigInt(v));

export const createPriceInput = z.object({
  interval: z.enum(["MONTH", "YEAR"]),
  marketType: z.enum(["GLOBAL", "REGION", "COUNTRY"]),
  marketCode: z.string().min(1).max(32),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amountMinor,
  effectiveFrom: z.coerce.date().optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  usageType: z.enum(["LICENSED", "SEAT", "METERED"]).default("LICENSED"),
  reason: z.string().trim().min(3).max(500),
});

async function validateMarketCurrency(tx: Tx, marketType: MarketType, marketCode: string, currency: string) {
  const cur = await tx.currency.findUnique({ where: { code: currency } });
  if (!cur || !cur.enabled) throw invalid(`Currency ${currency} is not enabled`);
  if (marketType === "GLOBAL" && marketCode !== "*") throw invalid("GLOBAL market code must be *");
  if (marketType === "COUNTRY") {
    const c = await tx.country.findUnique({ where: { code: marketCode } });
    if (!c) throw notFound(`Country ${marketCode}`);
    if (!c.supportedCurrencies.includes(currency)) throw invalid(`${currency} is not a supported currency in ${marketCode}`);
  }
}

/** Create a market price for a plan with its first version. Requires pricing.manage on that market. */
export async function createPrice(ctx: RequestContext, planId: string, raw: z.input<typeof createPriceInput>) {
  const input = createPriceInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await marketChain(tx, input.marketType, input.marketCode);
    await requirePermission(ctx, "pricing.manage", chain, tx);
    const plan = await tx.plan.findUnique({ where: { id: planId } });
    if (!plan) throw notFound("Plan");
    await validateMarketCurrency(tx, input.marketType, input.marketCode, input.currency);
    const dup = await tx.price.findUnique({
      where: { planId_interval_marketType_marketCode: { planId, interval: input.interval, marketType: input.marketType, marketCode: input.marketCode } },
    });
    if (dup) throw conflict("A price for this plan, interval and market already exists; schedule a new version instead");
    const price = await tx.price.create({
      data: {
        planId,
        interval: input.interval,
        marketType: input.marketType,
        marketCode: input.marketCode,
        currency: input.currency,
        usageType: input.usageType,
      },
    });
    const version = await tx.priceVersion.create({
      data: {
        priceId: price.id,
        version: 1,
        amountMinor: input.amountMinor,
        currency: input.currency,
        effectiveFrom: input.effectiveFrom ?? new Date(),
        trialDays: input.trialDays ?? null,
        reason: input.reason,
        createdById: ctx.actor.id,
      },
    });
    await writeAudit(tx, ctx, {
      category: "ADMIN",
      action: "pricing.price.created",
      resourceType: "price",
      resourceId: price.id,
      newValue: { plan: plan.key, ...input, priceVersionId: version.id },
      reason: input.reason,
    });
    await emitEvent(tx, ctx, "pricing.price.created", { priceId: price.id, planId, marketType: price.marketType, marketCode: price.marketCode, currency: price.currency }, {
      aggregateType: "price",
      aggregateId: price.id,
    });
    await emitEvent(tx, ctx, "pricing.price_version.created", {
      priceId: price.id,
      priceVersionId: version.id,
      version: 1,
      amountMinor: version.amountMinor.toString(),
      currency: version.currency,
      effectiveFrom: version.effectiveFrom.toISOString(),
    }, { aggregateType: "price", aggregateId: price.id });
    return { price, version };
  });
}

export const schedulePriceChangeInput = z.object({
  amountMinor,
  effectiveFrom: z.coerce.date().optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  reason: z.string().trim().min(3).max(500),
});

/** Clock-skew allowance for "effective now" changes. */
const PAST_TOLERANCE_MS = 60_000;

/**
 * Change a price going forward (docs/billing.md §3). Locks the price row, end-dates the open
 * version at `effectiveFrom`, appends version+1. Historical versions — and subscriptions that
 * reference them — are never modified.
 */
export async function schedulePriceChange(ctx: RequestContext, priceId: string, raw: z.input<typeof schedulePriceChangeInput>) {
  const input = schedulePriceChangeInput.parse(raw);
  const now = Date.now();
  const effectiveFrom = input.effectiveFrom ?? new Date(now);
  if (effectiveFrom.getTime() < now - PAST_TOLERANCE_MS) throw invalid("Price changes cannot be retroactive");

  return transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM prices WHERE id = ${priceId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound("Price");
    const price = await tx.price.findUniqueOrThrow({ where: { id: priceId }, include: { plan: true } });
    const chain: ScopeChain = await marketChain(tx, price.marketType, price.marketCode);
    await requirePermission(ctx, "pricing.manage", chain, tx);

    const open = await tx.priceVersion.findFirst({ where: { priceId, effectiveTo: null }, orderBy: { version: "desc" } });
    const last = await tx.priceVersion.findFirst({ where: { priceId }, orderBy: { version: "desc" } });
    if (!last) throw conflict("Price has no versions");
    if (open && effectiveFrom.getTime() <= open.effectiveFrom.getTime()) {
      throw invalid("New version must start after the current version's start");
    }
    if (!open && last.effectiveTo && effectiveFrom.getTime() < last.effectiveTo.getTime()) {
      throw invalid("New version would overlap an existing version");
    }
    if (open) await tx.priceVersion.update({ where: { id: open.id }, data: { effectiveTo: effectiveFrom } });

    const created = await tx.priceVersion.create({
      data: {
        priceId,
        version: last.version + 1,
        amountMinor: input.amountMinor,
        currency: price.currency,
        effectiveFrom,
        trialDays: input.trialDays ?? null,
        reason: input.reason,
        createdById: ctx.actor.id,
      },
    });
    await writeAudit(tx, ctx, {
      category: "ADMIN",
      action: "pricing.price_version.created",
      resourceType: "price",
      resourceId: priceId,
      oldValue: open ? { version: open.version, amountMinor: open.amountMinor, currency: open.currency, effectiveFrom: open.effectiveFrom } : null,
      newValue: { version: created.version, amountMinor: created.amountMinor, currency: created.currency, effectiveFrom: created.effectiveFrom, plan: price.plan.key, market: `${price.marketType}:${price.marketCode}`, interval: price.interval },
      reason: input.reason,
    });
    await emitEvent(tx, ctx, "pricing.price_version.created", {
      priceId,
      priceVersionId: created.id,
      version: created.version,
      amountMinor: created.amountMinor.toString(),
      currency: created.currency,
      effectiveFrom: created.effectiveFrom.toISOString(),
    }, { aggregateType: "price", aggregateId: priceId });
    return created;
  });
}

export async function setPriceStatus(ctx: RequestContext, priceId: string, status: "ACTIVE" | "INACTIVE", reason: string) {
  if (reason.trim().length < 3) throw invalid("A reason is required");
  return transaction(async (tx) => {
    const price = await tx.price.findUnique({ where: { id: priceId } });
    if (!price) throw notFound("Price");
    await requirePermission(ctx, "pricing.manage", await marketChain(tx, price.marketType, price.marketCode), tx);
    const after = await tx.price.update({ where: { id: priceId }, data: { status } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "pricing.price.status_changed", resourceType: "price", resourceId: priceId, oldValue: { status: price.status }, newValue: { status }, reason });
    return after;
  });
}

export const entitlementInput = z.object({
  featureKey: z.string().regex(/^[a-z][a-z0-9_.]{1,60}$/),
  enabled: z.boolean(),
  limitValue: z.union([z.string().regex(/^\d{1,15}$/), z.number().int().nonnegative()]).transform((v) => BigInt(v)).nullable().optional(),
  reason: z.string().trim().min(3).max(500),
});

export async function setEntitlement(ctx: RequestContext, planId: string, raw: z.input<typeof entitlementInput>) {
  const input = entitlementInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "pricing.manage", platformChain(), tx);
    if (!(await tx.plan.findUnique({ where: { id: planId } }))) throw notFound("Plan");
    const before = await tx.planEntitlement.findUnique({ where: { planId_featureKey: { planId, featureKey: input.featureKey } } });
    const after = await tx.planEntitlement.upsert({
      where: { planId_featureKey: { planId, featureKey: input.featureKey } },
      update: { enabled: input.enabled, limitValue: input.limitValue ?? null },
      create: { planId, featureKey: input.featureKey, enabled: input.enabled, limitValue: input.limitValue ?? null },
    });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "pricing.entitlement.set", resourceType: "plan", resourceId: planId, oldValue: before, newValue: after, reason: input.reason });
    return after;
  });
}

// ───────────── Promotions ─────────────

export const createPromotionInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    discountType: z.enum(["PERCENT", "AMOUNT"]),
    percentOffBps: z.number().int().min(1).max(10_000).optional(),
    amountOffMinor: amountMinor.optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    planKeys: z.array(planKey).default([]),
    countryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).default([]),
    regionCodes: z.array(z.string().min(1).max(32)).default([]),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().optional(),
    maxRedemptions: z.number().int().positive().optional(),
    couponCode: z.string().regex(/^[A-Z0-9_-]{3,40}$/).optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => (v.discountType === "PERCENT" ? v.percentOffBps != null : v.amountOffMinor != null && !!v.currency), {
    message: "PERCENT needs percentOffBps; AMOUNT needs amountOffMinor and currency",
  });

export async function createPromotion(ctx: RequestContext, raw: z.input<typeof createPromotionInput>) {
  const { couponCode, reason, ...input } = createPromotionInput.parse(raw);
  return transaction(async (tx) => {
    // Promotions restricted to one market need pricing.manage there; unrestricted ones need platform.
    const chains: ScopeChain[] = [];
    for (const c of input.countryCodes) chains.push(await marketChain(tx, "COUNTRY", c));
    for (const r of input.regionCodes) chains.push(await marketChain(tx, "REGION", r));
    if (chains.length === 0) chains.push(platformChain());
    for (const chain of chains) await requirePermission(ctx, "pricing.manage", chain, tx);

    const promo = await tx.promotion.create({ data: input });
    if (couponCode) {
      if (await tx.coupon.findUnique({ where: { code: couponCode } })) throw conflict("Coupon code already exists");
      await tx.coupon.create({ data: { promotionId: promo.id, code: couponCode } });
    }
    await writeAudit(tx, ctx, { category: "ADMIN", action: "pricing.promotion.created", resourceType: "promotion", resourceId: promo.id, newValue: { ...promo, couponCode }, reason });
    return promo;
  });
}

/** Check a coupon against plan, market and window; returns the applicable discount or null. */
export async function findApplicableCoupon(
  client: Tx | Db,
  code: string,
  args: { planKey: string; countryCode: string; regionCode: string; at: Date; currency: string },
) {
  const coupon = await client.coupon.findUnique({ where: { code: code.toUpperCase() }, include: { promotion: true } });
  if (!coupon) return null;
  const p = coupon.promotion;
  if (p.status !== "ACTIVE" || p.startsAt > args.at || (p.endsAt && p.endsAt <= args.at)) return null;
  if (p.maxRedemptions != null && coupon.redemptions >= p.maxRedemptions) return null;
  if (p.planKeys.length && !p.planKeys.includes(args.planKey)) return null;
  const marketRestricted = p.countryCodes.length > 0 || p.regionCodes.length > 0;
  if (marketRestricted && !p.countryCodes.includes(args.countryCode) && !p.regionCodes.includes(args.regionCode)) return null;
  if (p.discountType === "AMOUNT" && p.currency !== args.currency) return null;
  return { coupon, promotion: p };
}

