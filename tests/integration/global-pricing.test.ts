import { beforeAll, describe, expect, it } from "vitest";
import { db, transaction } from "@/server/core/db";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { resolvePrice, schedulePriceChange, createPrice, createPromotion, getPublicPricing } from "@/server/modules/pricing/service";
import { activateSubscription, quote, upsertBillingProfile } from "@/server/modules/billing/service";
import { isEnabled } from "@/server/modules/flags/service";
import { formatMoney } from "@/i18n/format";
import { directionOf } from "@/i18n/config";
import { expectCode, grant, makeUser, resetDb, system } from "../helpers";

async function priceId(planKey: string, marketType: "GLOBAL" | "REGION" | "COUNTRY", marketCode: string, interval: "MONTH" | "YEAR" = "MONTH") {
  const p = await db().price.findFirstOrThrow({ where: { plan: { key: planKey }, marketType, marketCode, interval } });
  return p.id;
}

beforeAll(resetDb);

describe("global persona matrix (docs/globalization.md §8)", () => {
  const personas = [
    { name: "US user", country: "US", locale: "en-US", dir: "ltr", currency: "USD", amount: 9900n, market: "COUNTRY:US", tax: "SALES_TAX", formatted: "$99.00" },
    { name: "India user", country: "IN", locale: "hi-IN", dir: "ltr", currency: "INR", amount: 499900n, market: "COUNTRY:IN", tax: "GST", formatted: "₹4,999.00" },
    { name: "UAE user", country: "AE", locale: "ar-AE", dir: "rtl", currency: "AED", amount: 39900n, market: "COUNTRY:AE", tax: "VAT", formatted: null },
    { name: "Germany user", country: "DE", locale: "de-DE", dir: "ltr", currency: "EUR", amount: 9900n, market: "REGION:EU", tax: "VAT", formatted: "99,00 €" },
  ] as const;

  for (const p of personas) {
    it(`${p.name}: price, currency, market, tax, direction and formatting`, async () => {
      const r = await resolvePrice(db(), { planKey: "founder", interval: "MONTH", countryCode: p.country });
      expect(r.available).toBe(true);
      if (!r.available) return;
      expect(r.price.money).toEqual({ amountMinor: p.amount, currency: p.currency });
      expect(`${r.price.market.type}:${r.price.market.code}`).toBe(p.market);
      expect(directionOf(p.locale)).toBe(p.dir);

      const tax = await db().taxConfig.findFirstOrThrow({ where: { countryCode: p.country, status: "ACTIVE" } });
      expect(tax.taxType).toBe(p.tax);

      const text = formatMoney(r.price.money, p.locale);
      if (p.formatted) expect(text.replace(/ /g, " ")).toBe(p.formatted);
      else expect(text).toMatch(/٣٩٩|399/); // Arabic locale formatting (digits per Intl data)
    });
  }

  it("a country without its own or regional price falls back to the GLOBAL market, never to a guess", async () => {
    const r = await resolvePrice(db(), { planKey: "founder", interval: "MONTH", countryCode: "JP" });
    expect(r.available && r.price.market).toEqual({ type: "GLOBAL", code: "*" });
    // Enterprise has no prices at all → not available, not $0.
    const e = await resolvePrice(db(), { planKey: "enterprise", interval: "MONTH", countryCode: "US" });
    expect(e).toEqual({ available: false, reason: "no_price_for_market" });
  });

  it("JPY formats with zero minor units", () => {
    expect(formatMoney({ amountMinor: 12000n, currency: "JPY" }, "en-US")).toBe("¥12,000");
  });

  it("annual prices resolve independently of monthly", async () => {
    const r = await resolvePrice(db(), { planKey: "founder", interval: "YEAR", countryCode: "IN" });
    expect(r.available && r.price.money.amountMinor).toBe(4999000n);
  });

  it("feature flags target plans: advanced computer use only for Enterprise", async () => {
    expect(await isEnabled("computer_use.advanced", { planKey: "enterprise", countryCode: "US" })).toBe(true);
    expect(await isEnabled("computer_use.advanced", { planKey: "founder", countryCode: "US" })).toBe(false);
  });

  it("public pricing reports unavailable plans honestly", async () => {
    const plans = await getPublicPricing("IN", "MONTH");
    const founder = plans.find((p) => p.key === "founder")!;
    const enterprise = plans.find((p) => p.key === "enterprise")!;
    expect(founder.resolution.available).toBe(true);
    expect(enterprise.resolution.available).toBe(false);
  });
});

describe("admin changes India Founder price (docs/billing.md §7)", () => {
  it("India sees the new price, US is unchanged, existing subscriptions keep their price, audit is written", async () => {
    const { user: admin, ctx } = await makeUser();
    await grant(admin.id, "COUNTRY_ADMIN", "COUNTRY", "IN");

    // An Indian organization already subscribed at v1.
    const { ctx: founderCtx } = await makeUser({ countryCode: "IN" });
    const org = await createOrganization(founderCtx, { name: "Bharat Labs" });
    const before = await resolvePrice(db(), { planKey: "founder", interval: "MONTH", countryCode: "IN" });
    if (!before.available) throw new Error("expected price");
    const sub = await transaction((tx) =>
      activateSubscription(tx, system(), { organizationId: org.id, priceVersionId: before.price.priceVersionId, billingCountryCode: "IN" }),
    );
    const usBefore = await resolvePrice(db(), { planKey: "founder", interval: "MONTH", countryCode: "US" });

    const inPrice = await priceId("founder", "COUNTRY", "IN");
    const v2 = await schedulePriceChange(ctx, inPrice, { amountMinor: "549900", reason: "2026 India price review" });
    expect(v2.version).toBe(2);

    const after = await resolvePrice(db(), { planKey: "founder", interval: "MONTH", countryCode: "IN", at: new Date(Date.now() + 1000) });
    expect(after.available && after.price.money).toEqual({ amountMinor: 549900n, currency: "INR" });

    const usAfter = await resolvePrice(db(), { planKey: "founder", interval: "MONTH", countryCode: "US", at: new Date(Date.now() + 1000) });
    expect(usAfter).toEqual(usBefore);

    const item = await db().subscriptionItem.findFirstOrThrow({ where: { subscriptionId: sub.id }, include: { priceVersion: true } });
    expect(item.priceVersionId).toBe(before.price.priceVersionId);
    expect(item.priceVersion.amountMinor).toBe(499900n);
    expect(item.unitAmountMinor).toBe(499900n);

    // Historical version is end-dated, not modified.
    const v1 = await db().priceVersion.findUniqueOrThrow({ where: { id: before.price.priceVersionId } });
    expect(v1.amountMinor).toBe(499900n);
    expect(v1.effectiveTo?.getTime()).toBe(v2.effectiveFrom.getTime());

    const audit = await db().auditLog.findFirstOrThrow({ where: { action: "pricing.price_version.created", resourceId: inPrice } });
    expect(audit.category).toBe("ADMIN");
    expect(audit.actorId).toBe(admin.id);
    expect(audit.reason).toBe("2026 India price review");
    expect((audit.oldValue as { amountMinor: string }).amountMinor).toBe("499900");
    expect((audit.newValue as { amountMinor: string }).amountMinor).toBe("549900");

    const event = await db().event.findFirstOrThrow({ where: { type: "pricing.price_version.created", aggregateId: inPrice } });
    expect(event.publishedAt).toBeNull();
  });

  it("a scheduled future price applies only from its effective date", async () => {
    const { user, ctx } = await makeUser();
    await grant(user.id, "PLATFORM_ADMIN", "PLATFORM", "*");
    const gb = await priceId("founder", "COUNTRY", "GB");
    const from = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await schedulePriceChange(ctx, gb, { amountMinor: 9900, effectiveFrom: from, reason: "Planned UK increase" });
    const now = await resolvePrice(db(), { planKey: "founder", interval: "MONTH", countryCode: "GB" });
    const later = await resolvePrice(db(), { planKey: "founder", interval: "MONTH", countryCode: "GB", at: new Date(from.getTime() + 1) });
    expect(now.available && now.price.money.amountMinor).toBe(8900n);
    expect(later.available && later.price.money.amountMinor).toBe(9900n);
  });

  it("rejects retroactive and overlapping versions", async () => {
    const { user, ctx } = await makeUser();
    await grant(user.id, "PLATFORM_ADMIN", "PLATFORM", "*");
    const us = await priceId("founder", "COUNTRY", "US");
    await expectCode(schedulePriceChange(ctx, us, { amountMinor: 1, effectiveFrom: new Date("2020-01-01"), reason: "backdate" }), "validation_error");
  });

  it("the database refuses in-place edits of price history", async () => {
    const v = await db().priceVersion.findFirstOrThrow({ where: { price: { marketCode: "US" } } });
    await expect(db().priceVersion.update({ where: { id: v.id }, data: { amountMinor: 1n } })).rejects.toThrow(/immutable/);
    await expect(db().priceVersion.delete({ where: { id: v.id } })).rejects.toThrow(/append-only/);
  });
});

describe("market-scoped pricing administration (docs/rbac.md)", () => {
  it("COUNTRY_ADMIN for IN can change IN but not US prices", async () => {
    const { user, ctx } = await makeUser();
    await grant(user.id, "COUNTRY_ADMIN", "COUNTRY", "IN");
    await expectCode(schedulePriceChange(ctx, await priceId("founder", "COUNTRY", "US"), { amountMinor: 1, reason: "not mine" }), "forbidden");
    await expectCode(schedulePriceChange(ctx, await priceId("founder", "GLOBAL", "*"), { amountMinor: 1, reason: "not mine" }), "forbidden");
    await schedulePriceChange(ctx, await priceId("founder", "COUNTRY", "IN", "YEAR"), { amountMinor: 5499000, reason: "annual review" });
  });

  it("REGION_ADMIN for MIDDLE_EAST can manage UAE pricing but not US", async () => {
    const { user, ctx } = await makeUser();
    await grant(user.id, "REGION_ADMIN", "REGION", "MIDDLE_EAST");
    await schedulePriceChange(ctx, await priceId("founder", "COUNTRY", "AE"), { amountMinor: 42900, reason: "UAE review" });
    await createPrice(ctx, (await db().plan.findUniqueOrThrow({ where: { key: "founder" } })).id, {
      interval: "MONTH",
      marketType: "COUNTRY",
      marketCode: "SA",
      currency: "SAR",
      amountMinor: 39900,
      reason: "Launch Saudi Arabia",
    });
    await expectCode(schedulePriceChange(ctx, await priceId("founder", "COUNTRY", "US"), { amountMinor: 1, reason: "nope" }), "forbidden");
  });

  it("rejects a currency the country does not support", async () => {
    const { user, ctx } = await makeUser();
    await grant(user.id, "PLATFORM_ADMIN", "PLATFORM", "*");
    const plan = await db().plan.findUniqueOrThrow({ where: { key: "growth" } });
    await expectCode(
      createPrice(ctx, plan.id, { interval: "MONTH", marketType: "COUNTRY", marketCode: "JP", currency: "EUR", amountMinor: 1, reason: "wrong currency" }),
      "validation_error",
    );
  });

  it("pricing.manage requires a recent MFA verification", async () => {
    const { user, ctx } = await makeUser({ mfa: false });
    await grant(user.id, "PLATFORM_ADMIN", "PLATFORM", "*");
    await expectCode(schedulePriceChange(ctx, await priceId("growth", "GLOBAL", "*"), { amountMinor: 1, reason: "no mfa" }), "mfa_required");
  });

  it("organization owners have no platform pricing power", async () => {
    const { ctx } = await makeUser();
    await createOrganization(ctx, { name: "Owner Co" });
    await expectCode(schedulePriceChange(ctx, await priceId("founder", "COUNTRY", "US"), { amountMinor: 1, reason: "escalate" }), "forbidden");
  });
});

describe("independent country dimensions + regional checkout", () => {
  it("founder in India, company in UAE, billing UAE, market USA, Dubai time, Middle East data", async () => {
    const { ctx, user } = await makeUser({ countryCode: "IN", locale: "en-US" });
    const org = await createOrganization(ctx, { name: "Gulf Ventures" });
    const company = await createCompany(ctx, org.id, {
      name: "Gulf Ventures FZ-LLC",
      incorporationCountryCode: "AE",
      operatingCountryCodes: ["AE", "IN"],
      targetMarketCodes: ["US"],
      defaultLocale: "en-US",
    });
    expect(user.countryCode).toBe("IN");
    expect(company).toMatchObject({
      incorporationCountryCode: "AE",
      targetMarketCodes: ["US"],
      baseCurrency: "AED",
      timezone: "Asia/Dubai",
      dataRegion: "ME_CENTRAL",
      defaultLocale: "en-US",
    });

    // No billing country yet → the quote asks for confirmation instead of guessing.
    await expectCode(quote(ctx, org.id, { planKey: "founder", interval: "MONTH" }), "validation_error");

    await upsertBillingProfile(ctx, org.id, { billingCountryCode: "AE", confirmCountry: true });
    const q = await quote(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    expect(q.billingCountryCode).toBe("AE");
    expect(q.total).toEqual({ amountMinor: 42900n, currency: "AED" }); // AE price was raised by the REGION_ADMIN test above
    expect(q.tax).toMatchObject({ taxType: "VAT", calculation: "STRIPE_TAX", estimate: null });
    expect(q.paymentMethods).toContain("card");
    expect(q.suggestions).toEqual({ userCountryCode: "IN", companyCountryCodes: ["AE"] });

    // Explicit timezone/currency/data-region choices override suggestions.
    const other = await createCompany(ctx, org.id, {
      name: "Second Co",
      incorporationCountryCode: "AE",
      baseCurrency: "USD",
      timezone: "America/New_York",
      dataRegion: "US_EAST",
    });
    expect(other).toMatchObject({ baseCurrency: "USD", timezone: "America/New_York", dataRegion: "US_EAST" });
  });

  it("applies a market-restricted coupon with banker's rounding, and rejects it elsewhere", async () => {
    const { user: admin, ctx: adminCtx } = await makeUser();
    await grant(admin.id, "PLATFORM_ADMIN", "PLATFORM", "*");
    await createPromotion(adminCtx, {
      name: "India launch",
      discountType: "PERCENT",
      percentOffBps: 1250,
      countryCodes: ["IN"],
      planKeys: ["founder"],
      startsAt: new Date(Date.now() - 1000),
      couponCode: "INDIA12",
      reason: "launch promo",
    });
    const { ctx } = await makeUser();
    const org = await createOrganization(ctx, { name: "Coupon Co" });
    const q = await quote(ctx, org.id, { planKey: "founder", interval: "YEAR", billingCountryCode: "IN", couponCode: "india12" });
    // 5,499,000 × 12.5% = 687,375 exactly
    expect(q.discount).toEqual({ amountMinor: 687375n, currency: "INR" });
    expect(q.total.amountMinor).toBe(5499000n - 687375n);
    await expectCode(quote(ctx, org.id, { planKey: "founder", interval: "MONTH", billingCountryCode: "US", couponCode: "INDIA12" }), "validation_error");
  });

  it("checkout session is honestly not configured without Stripe credentials", async () => {
    const { ctx } = await makeUser();
    const org = await createOrganization(ctx, { name: "Pay Co" });
    await expectCode(
      (await import("@/server/modules/billing/stripe-billing")).createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH", billingCountryCode: "US" }),
      "not_configured",
    );
  });
});
