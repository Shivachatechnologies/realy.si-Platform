/**
 * What an organization can buy next: plan offers (monthly / annual, resolved for its billing country through the
 * pricing catalog) and add-on packs, plus whether checkout can run (Stripe configured, billing country confirmed).
 * Feeds the UpgradePrompt and the Billing & usage page.
 */
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden } from "@/server/core/errors";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { resolvePrice } from "@/server/modules/pricing/service";
import { billingConfig } from "@/server/modules/billing/gateway";
import { ADDONS, ADDON_KEYS, ANNUAL_MONTHS_CHARGED, PLAN_KEYS, PLAN_PRICES, type AddonKey, type FeatureKey, type PlanKey } from "./catalog";
import { planTable, usageSummary } from "./service";

export interface WireMoney {
  amountMinor: string;
  currency: string;
}

export interface PlanOffer {
  key: PlanKey;
  name: string;
  description: string;
  monthly: WireMoney | null;
  annual: WireMoney | null;
  /** Prices come from the catalog defaults (no market price for the billing country yet). */
  indicative: boolean;
}

const wire = (amountMinor: bigint | number, currency: string): WireMoney => ({ amountMinor: String(amountMinor), currency });

/** Plan prices for a billing country (catalog USD list price when the country has none / is unknown). */
export async function planOffers(countryCode: string | null): Promise<PlanOffer[]> {
  const plans = await planTable();
  return Promise.all(
    PLAN_KEYS.map(async (key) => {
      const p = plans.find((x) => x.key === key)!;
      const [m, y] = countryCode
        ? await Promise.all([
            resolvePrice(db(), { planKey: key, interval: "MONTH", countryCode }).catch(() => null),
            resolvePrice(db(), { planKey: key, interval: "YEAR", countryCode }).catch(() => null),
          ])
        : [null, null];
      const monthly = m?.available ? wire(m.price.money.amountMinor, m.price.money.currency) : null;
      const annual = y?.available ? wire(y.price.money.amountMinor, y.price.money.currency) : null;
      const indicative = !monthly && !annual;
      return {
        key,
        name: p.name,
        description: p.description,
        monthly: monthly ?? (indicative ? wire(PLAN_PRICES[key].USD, "USD") : null),
        annual: annual ?? (indicative ? wire(PLAN_PRICES[key].USD * ANNUAL_MONTHS_CHARGED, "USD") : null),
        indicative,
      };
    }),
  );
}

export interface AddonOffer {
  key: AddonKey;
  limit: string;
  quantity: number;
  price: WireMoney;
  requires: FeatureKey | null;
  maxPacks: number;
}

export function addonOffers(currency: string): AddonOffer[] {
  const cur = currency === "EUR" ? "EUR" : "USD";
  return ADDON_KEYS.map((key) => {
    const a = ADDONS[key];
    return { key, limit: a.limit, quantity: a.quantity, price: wire(a.prices[cur], cur), requires: (a as { requires?: FeatureKey }).requires ?? null, maxPacks: a.maxPacks };
  });
}

/** Everything the upgrade prompt / billing page needs, for any member of the organization. */
export async function entitlementOverview(ctx: RequestContext, organizationId: string) {
  if (ctx.actor.type === "USER") {
    const member = ctx.actor.id ? await db().membership.count({ where: { organizationId, userId: ctx.actor.id, status: "ACTIVE" } }) : 0;
    if (!member) throw forbidden("Not a member of this organization");
  }
  const chain = orgChain(organizationId);
  const [summary, profile, canManage] = await Promise.all([
    usageSummary(organizationId),
    db().billingProfile.findUnique({ where: { organizationId }, select: { billingCountryCode: true, billingCountryConfirmedAt: true, currency: true, stripeCustomerId: true } }),
    can(ctx, "billing.manage", chain),
  ]);
  const country = profile?.billingCountryConfirmedAt ? profile.billingCountryCode : null;
  const offers = await planOffers(country);
  const ent = summary.entitlements;
  return {
    organizationId,
    state: ent.state,
    plan: ent.plan,
    planName: ent.planName,
    subscription: ent.subscription,
    trialEndsAt: ent.trialEndsAt,
    window: ent.window,
    enforced: ent.enforced,
    features: ent.features,
    usage: summary.rows,
    offers,
    addons: addonOffers(offers.find((o) => o.monthly)?.monthly?.currency ?? profile?.currency ?? "USD"),
    billing: {
      configured: billingConfig() !== null,
      countryConfirmed: !!country,
      hasBillingAccount: !!profile?.stripeCustomerId,
      canManage,
    },
  };
}

export type EntitlementOverview = Awaited<ReturnType<typeof entitlementOverview>>;
