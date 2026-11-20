import type { PrismaClient } from "@/generated/prisma/client";
import type { BillingInterval, MarketType } from "@/generated/prisma/enums";
import { ANNUAL_MONTHS_CHARGED, CATALOG_VERSION, CATALOG_VERSION_KEY, PLAN_KEYS, PLAN_META, PLAN_PRICES, catalogEntitlementRows } from "./catalog";

export const CATALOG_SEED_REASON = "Realy plan catalog";
const EFFECTIVE_FROM = new Date("2026-01-01T00:00:00Z");

const MARKETS: { marketType: MarketType; marketCode: string; currency: "USD" | "EUR" }[] = [
  { marketType: "GLOBAL", marketCode: "*", currency: "USD" },
  { marketType: "REGION", marketCode: "EU", currency: "EUR" },
];

/**
 * Seed the Starter / Growth / Scale catalog (docs/entitlements.md §Seed). Additive and idempotent: plans, prices and
 * entitlements are upserted, nothing is deleted, subscriptions are never touched.
 *
 * Admin edits win: catalog values are (re)applied to a plan only when its `catalog.version` entitlement is older
 * than CATALOG_VERSION. Then entitlement rows take the catalog values and a price whose open version was created by
 * this seed (no author) with another amount gets a new version (the old one is end-dated, never rewritten).
 */
export async function seedPlanCatalog(db: PrismaClient): Promise<void> {
  const product = await db.billingProduct.upsert({ where: { key: "realy-platform" }, update: {}, create: { key: "realy-platform", name: "Realy Platform" } });
  const now = new Date();

  for (const key of PLAN_KEYS) {
    const meta = PLAN_META[key];
    const plan = await db.plan.upsert({
      where: { key },
      update: {},
      create: { key, name: meta.name, description: meta.description, productId: product.id, status: "ACTIVE", public: true, sortOrder: meta.sortOrder, defaultTrialDays: 0 },
    });
    const marker = await db.planEntitlement.findUnique({ where: { planId_featureKey: { planId: plan.id, featureKey: CATALOG_VERSION_KEY } } });
    const apply = !marker || Number(marker.limitValue ?? 0) < CATALOG_VERSION;

    if (apply) {
      await db.plan.update({ where: { id: plan.id }, data: { name: meta.name, description: meta.description, status: "ACTIVE", public: true, sortOrder: meta.sortOrder, defaultTrialDays: 0 } });
      for (const row of catalogEntitlementRows(key)) {
        await db.planEntitlement.upsert({
          where: { planId_featureKey: { planId: plan.id, featureKey: row.featureKey } },
          update: { enabled: row.enabled, limitValue: row.limitValue },
          create: { planId: plan.id, ...row },
        });
      }
    } else {
      // Keys added to the catalog since: create only; existing rows keep the administrators' values.
      await db.planEntitlement.createMany({ data: catalogEntitlementRows(key).map((r) => ({ planId: plan.id, ...r })), skipDuplicates: true });
    }

    for (const m of MARKETS) {
      for (const interval of ["MONTH", "YEAR"] as BillingInterval[]) {
        const amountMinor = BigInt(PLAN_PRICES[key][m.currency] * (interval === "YEAR" ? ANNUAL_MONTHS_CHARGED : 1));
        const price = await db.price.upsert({
          where: { planId_interval_marketType_marketCode: { planId: plan.id, interval, marketType: m.marketType, marketCode: m.marketCode } },
          update: {},
          create: { planId: plan.id, interval, marketType: m.marketType, marketCode: m.marketCode, currency: m.currency },
        });
        const last = await db.priceVersion.findFirst({ where: { priceId: price.id }, orderBy: { version: "desc" } });
        if (!last) {
          await db.priceVersion.create({ data: { priceId: price.id, version: 1, amountMinor, currency: m.currency, effectiveFrom: EFFECTIVE_FROM, reason: CATALOG_SEED_REASON } });
          continue;
        }
        const seedAuthored = last.createdById === null;
        if (apply && seedAuthored && last.effectiveTo === null && last.amountMinor !== amountMinor && price.currency === m.currency) {
          await db.priceVersion.update({ where: { id: last.id }, data: { effectiveTo: now } });
          await db.priceVersion.create({
            data: { priceId: price.id, version: last.version + 1, amountMinor, currency: m.currency, effectiveFrom: now, reason: `${CATALOG_SEED_REASON} v${CATALOG_VERSION}` },
          });
        }
      }
    }
  }

  // Development-only legacy plans (dev seed) stay for existing subscriptions but leave the public pricing page.
  if (process.env.NODE_ENV !== "production") {
    await db.plan.updateMany({ where: { key: { in: ["founder", "enterprise"] }, public: true }, data: { public: false } });
  }
}
