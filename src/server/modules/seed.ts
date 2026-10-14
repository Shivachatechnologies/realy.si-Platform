import type { PrismaClient } from "@/generated/prisma/client";
import type { BillingInterval, MarketType } from "@/generated/prisma/enums";
import { PERMISSIONS, SYSTEM_ROLES } from "./rbac/catalog";
import { COUNTRIES, CURRENCIES, FEATURE_FLAGS, LOCALES, REGIONS } from "./globalization/reference-data";

/** Reference data required in every environment. Idempotent. */
export async function seedReferenceData(db: PrismaClient): Promise<void> {
  for (const c of CURRENCIES) {
    await db.currency.upsert({ where: { code: c.code }, update: {}, create: { ...c } });
  }
  for (const l of LOCALES) {
    await db.locale.upsert({ where: { tag: l.tag }, update: {}, create: l });
  }
  for (const r of REGIONS) {
    await db.region.upsert({ where: { code: r.code }, update: {}, create: r });
  }
  for (const { tax, ...c } of COUNTRIES) {
    await db.country.upsert({ where: { code: c.code }, update: {}, create: c });
    const existing = await db.taxConfig.findFirst({ where: { countryCode: c.code } });
    if (!existing) {
      await db.taxConfig.create({
        data: { ...tax, countryCode: c.code, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
      });
    }
  }

  // Permissions and system roles are code-defined: keep the database in sync with the catalog.
  for (const p of PERMISSIONS) {
    const [resource, ...rest] = p.key.split(".");
    const action = rest.pop()!;
    const res = [resource, ...rest].join(".");
    await db.permission.upsert({
      where: { key: p.key },
      update: { description: p.description, platformOnly: !!p.platformOnly, resource: res, action },
      create: { key: p.key, description: p.description, platformOnly: !!p.platformOnly, resource: res, action },
    });
  }
  const permIds = new Map((await db.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]));

  for (const r of SYSTEM_ROLES) {
    const existing = await db.role.findFirst({ where: { organizationId: null, key: r.key } });
    const role = existing
      ? await db.role.update({
          where: { id: existing.id },
          data: { name: r.name, description: r.description, assignableAt: r.assignableAt, isSystem: true },
        })
      : await db.role.create({
          data: { key: r.key, name: r.name, description: r.description, assignableAt: r.assignableAt, isSystem: true },
        });
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({
      data: r.permissions.map((k) => {
        const permissionId = permIds.get(k);
        if (!permissionId) throw new Error(`Role ${r.key} references unknown permission ${k}`);
        return { roleId: role.id, permissionId };
      }),
    });
  }

  for (const f of FEATURE_FLAGS) {
    await db.featureFlag.upsert({ where: { key: f.key }, update: {}, create: f });
  }
}

interface DevPrice {
  interval: BillingInterval;
  marketType: MarketType;
  marketCode: string;
  currency: string;
  amountMinor: bigint;
}

const monthlyAndAnnual = (marketType: MarketType, marketCode: string, currency: string, monthly: bigint): DevPrice[] => [
  { interval: "MONTH", marketType, marketCode, currency, amountMinor: monthly },
  { interval: "YEAR", marketType, marketCode, currency, amountMinor: monthly * 10n },
];

/**
 * Illustrative catalog for development and tests ONLY (docs/billing.md §2). Production catalogs are
 * created by admins in the Pricing Console. Never called when NODE_ENV=production.
 */
export async function seedDevCatalog(db: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Dev catalog must not be seeded in production");

  const product = await db.billingProduct.upsert({
    where: { key: "realy-platform" },
    update: {},
    create: { key: "realy-platform", name: "Realy Platform" },
  });

  const plans: {
    key: string;
    name: string;
    sortOrder: number;
    trial: number;
    prices: DevPrice[];
    entitlements: { featureKey: string; enabled: boolean; limitValue: bigint | null }[];
  }[] = [
    {
      key: "founder",
      name: "Founder",
      sortOrder: 10,
      trial: 14,
      prices: [
        ...monthlyAndAnnual("GLOBAL", "*", "USD", 9900n),
        ...monthlyAndAnnual("COUNTRY", "US", "USD", 9900n),
        ...monthlyAndAnnual("COUNTRY", "IN", "INR", 499900n),
        ...monthlyAndAnnual("COUNTRY", "AE", "AED", 39900n),
        ...monthlyAndAnnual("COUNTRY", "GB", "GBP", 8900n),
        ...monthlyAndAnnual("REGION", "EU", "EUR", 9900n),
      ],
      entitlements: [
        { featureKey: "agents.max", enabled: true, limitValue: 20n },
        { featureKey: "companies.max", enabled: true, limitValue: 1n },
        { featureKey: "computer_use.advanced", enabled: false, limitValue: null },
      ],
    },
    {
      key: "growth",
      name: "Growth",
      sortOrder: 20,
      trial: 14,
      prices: [
        ...monthlyAndAnnual("GLOBAL", "*", "USD", 29900n),
        ...monthlyAndAnnual("COUNTRY", "IN", "INR", 1499900n),
        ...monthlyAndAnnual("COUNTRY", "AE", "AED", 109900n),
        ...monthlyAndAnnual("COUNTRY", "GB", "GBP", 24900n),
        ...monthlyAndAnnual("REGION", "EU", "EUR", 27900n),
      ],
      entitlements: [
        { featureKey: "agents.max", enabled: true, limitValue: 60n },
        { featureKey: "companies.max", enabled: true, limitValue: 3n },
        { featureKey: "computer_use.advanced", enabled: false, limitValue: null },
      ],
    },
    {
      key: "enterprise",
      name: "Enterprise",
      sortOrder: 30,
      trial: 0,
      prices: [],
      entitlements: [
        { featureKey: "agents.max", enabled: true, limitValue: null },
        { featureKey: "companies.max", enabled: true, limitValue: null },
        { featureKey: "computer_use.advanced", enabled: true, limitValue: null },
      ],
    },
  ];

  for (const p of plans) {
    const plan = await db.plan.upsert({
      where: { key: p.key },
      update: {},
      create: { key: p.key, name: p.name, productId: product.id, status: "ACTIVE", sortOrder: p.sortOrder, defaultTrialDays: p.trial },
    });
    for (const e of p.entitlements) {
      await db.planEntitlement.upsert({
        where: { planId_featureKey: { planId: plan.id, featureKey: e.featureKey } },
        update: {},
        create: { planId: plan.id, ...e },
      });
    }
    for (const pr of p.prices) {
      const price = await db.price.upsert({
        where: {
          planId_interval_marketType_marketCode: {
            planId: plan.id,
            interval: pr.interval,
            marketType: pr.marketType,
            marketCode: pr.marketCode,
          },
        },
        update: {},
        create: { planId: plan.id, interval: pr.interval, marketType: pr.marketType, marketCode: pr.marketCode, currency: pr.currency },
      });
      const hasVersion = await db.priceVersion.findFirst({ where: { priceId: price.id } });
      if (!hasVersion) {
        await db.priceVersion.create({
          data: {
            priceId: price.id,
            version: 1,
            amountMinor: pr.amountMinor,
            currency: pr.currency,
            effectiveFrom: new Date("2026-01-01T00:00:00Z"),
            reason: "Development seed catalog",
          },
        });
      }
    }
  }

  // Example targeting: advanced computer use only for Enterprise.
  const flag = await db.featureFlag.findUnique({ where: { key: "computer_use.advanced" } });
  if (flag) {
    await db.featureFlagRule.upsert({
      where: { flagId_targetType_targetValue: { flagId: flag.id, targetType: "PLAN", targetValue: "enterprise" } },
      update: {},
      create: { flagId: flag.id, targetType: "PLAN", targetValue: "enterprise", enabled: true },
    });
  }
}
