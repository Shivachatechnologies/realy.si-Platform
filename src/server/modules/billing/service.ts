import { z } from "zod";
import type { BillingInterval } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, forbidden, invalid, notFound } from "@/server/core/errors";
import { applyBps, money, subtractMoney, type Money } from "@/server/core/money";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { requirePermission } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { findApplicableCoupon, resolvePrice, type ResolvedPrice } from "@/server/modules/pricing/service";

const iso2 = z.string().regex(/^[A-Z]{2}$/);

export const billingProfileInput = z.object({
  billingCountryCode: iso2,
  legalName: z.string().trim().max(200).optional(),
  /** The user explicitly confirmed the billing country (never inferred from IP). */
  confirmCountry: z.literal(true),
});

export async function getBillingProfile(ctx: RequestContext, organizationId: string) {
  await requirePermission(ctx, "billing.read", orgChain(organizationId));
  return db().billingProfile.findUnique({ where: { organizationId } });
}

export async function upsertBillingProfile(ctx: RequestContext, organizationId: string, raw: z.input<typeof billingProfileInput>) {
  const input = billingProfileInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "billing.manage", orgChain(organizationId), tx);
    const country = await tx.country.findUnique({ where: { code: input.billingCountryCode } });
    if (!country || country.status !== "ACTIVE") throw invalid("Unknown country");
    if (!country.billingEnabled) throw new AppError("not_available", `Billing is not available in ${country.name}`);
    const before = await tx.billingProfile.findUnique({ where: { organizationId } });
    const data = {
      billingCountryCode: country.code,
      billingCountryConfirmedAt: new Date(),
      currency: country.defaultCurrency,
      legalName: input.legalName ?? before?.legalName ?? null,
    };
    const after = await tx.billingProfile.upsert({ where: { organizationId }, update: data, create: { organizationId, ...data } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "billing.profile.updated", resourceType: "billing_profile", resourceId: after.id, oldValue: before, newValue: after });
    await emitEvent(tx, ctx, "billing.profile.updated", { organizationId, billingCountryCode: country.code }, {
      organizationId,
      aggregateType: "billing_profile",
      aggregateId: after.id,
    });
    return after;
  });
}

export const quoteInput = z.object({
  planKey: z.string().min(1).max(41),
  interval: z.enum(["MONTH", "YEAR"]),
  /** Billing country the user is confirming; defaults to the billing profile's. */
  billingCountryCode: iso2.optional(),
  couponCode: z.string().trim().max(40).optional(),
});

export interface Quote {
  billingCountryCode: string;
  /** Whether the billing country came from a confirmed profile/input (UI must confirm otherwise). */
  billingCountrySource: "input" | "profile";
  suggestions: { userCountryCode: string | null; companyCountryCodes: string[] };
  price: ResolvedPrice;
  subtotal: Money;
  discount: Money | null;
  couponCode: string | null;
  total: Money;
  tax: {
    taxType: string;
    displayName: string;
    priceIncludesTax: boolean;
    calculation: "STRIPE_TAX" | "MANUAL";
    /** Only for MANUAL configs; STRIPE_TAX is calculated at checkout by the provider. */
    estimate: Money | null;
  } | null;
  paymentMethods: string[];
  trialDays: number;
}

/**
 * Regional checkout quote (docs/billing.md §5). Computes everything server-side; the client never
 * submits prices. Nothing is persisted.
 */
export async function quote(ctx: RequestContext, organizationId: string, raw: z.input<typeof quoteInput>, at = new Date()): Promise<Quote> {
  const input = quoteInput.parse(raw);
  await requirePermission(ctx, "billing.read", orgChain(organizationId));
  const client = db();

  const profile = await client.billingProfile.findUnique({ where: { organizationId } });
  const billingCountryCode = input.billingCountryCode ?? profile?.billingCountryCode;
  if (!billingCountryCode) throw invalid("Confirm a billing country to get a quote", { field: "billingCountryCode" });

  const country = await client.country.findUnique({ where: { code: billingCountryCode } });
  if (!country) throw invalid("Unknown country");
  const resolution = await resolvePrice(client, { planKey: input.planKey, interval: input.interval as BillingInterval, countryCode: billingCountryCode, at });
  if (!resolution.available) {
    throw new AppError("not_available", "This plan is not available for the selected billing country", { reason: resolution.reason });
  }
  const price = resolution.price;
  const subtotal = price.money;

  let discount: Money | null = null;
  let couponCode: string | null = null;
  if (input.couponCode) {
    const applicable = await findApplicableCoupon(client, input.couponCode, {
      planKey: input.planKey,
      countryCode: billingCountryCode,
      regionCode: country.regionCode,
      at,
      currency: subtotal.currency,
    });
    if (!applicable) throw invalid("This coupon is not valid for this plan or country", { field: "couponCode" });
    const p = applicable.promotion;
    discount = p.discountType === "PERCENT" ? applyBps(subtotal, p.percentOffBps!) : money(p.amountOffMinor!, p.currency!);
    if (discount.amountMinor > subtotal.amountMinor) discount = subtotal;
    couponCode = applicable.coupon.code;
  }
  const total = discount ? subtractMoney(subtotal, discount) : subtotal;

  const taxConfig = await client.taxConfig.findFirst({
    where: {
      countryCode: billingCountryCode,
      subdivision: null,
      status: "ACTIVE",
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });

  const [user, companies] = await Promise.all([
    ctx.actor.type === "USER" ? client.user.findUnique({ where: { id: ctx.actor.id! }, select: { countryCode: true } }) : null,
    client.company.findMany({ where: { organizationId, deletedAt: null }, select: { incorporationCountryCode: true } }),
  ]);

  return {
    billingCountryCode,
    billingCountrySource: input.billingCountryCode ? "input" : "profile",
    suggestions: {
      userCountryCode: user?.countryCode ?? null,
      companyCountryCodes: [...new Set(companies.map((c) => c.incorporationCountryCode).filter((c): c is string => !!c))],
    },
    price,
    subtotal,
    discount,
    couponCode,
    total,
    tax: taxConfig
      ? {
          taxType: taxConfig.taxType,
          displayName: taxConfig.displayName,
          priceIncludesTax: taxConfig.priceIncludesTax,
          calculation: taxConfig.calculation,
          estimate: taxConfig.calculation === "MANUAL" && !taxConfig.priceIncludesTax ? applyBps(total, taxConfig.rateBps) : null,
        }
      : null,
    paymentMethods: country.paymentMethods,
    trialDays: price.trialDays,
  };
}

/**
 * Activate a subscription locked to the exact price version that was quoted. Called by the payment
 * provider's webhook handler (SYSTEM actor) — never directly from a client request.
 */
export async function activateSubscription(
  tx: Tx,
  ctx: RequestContext,
  args: { organizationId: string; priceVersionId: string; billingCountryCode: string; quantity?: number; stripeSubscriptionId?: string },
) {
  if (ctx.actor.type !== "SYSTEM") throw forbidden("Subscriptions are activated by the payment provider");
  const version = await tx.priceVersion.findUnique({ where: { id: args.priceVersionId }, include: { price: { include: { plan: true } } } });
  if (!version) throw notFound("Price version");
  const sub = await tx.subscription.create({
    data: {
      organizationId: args.organizationId,
      planId: version.price.planId,
      status: "ACTIVE",
      currency: version.currency,
      billingCountryCode: args.billingCountryCode,
      interval: version.price.interval,
      currentPeriodStart: new Date(),
      stripeSubscriptionId: args.stripeSubscriptionId ?? null,
      items: {
        create: {
          // organization_id is inherited from the parent subscription (composite FK keeps them equal).
          priceVersionId: version.id,
          quantity: args.quantity ?? 1,
          unitAmountMinor: version.amountMinor,
          currency: version.currency,
        },
      },
    },
    include: { items: true },
  });
  await writeAudit(tx, ctx, {
    category: "TENANT",
    organizationId: args.organizationId,
    action: "billing.subscription.activated",
    resourceType: "subscription",
    resourceId: sub.id,
    newValue: { plan: version.price.plan.key, priceVersionId: version.id, amountMinor: version.amountMinor, currency: version.currency },
  });
  return sub;
}

export async function getActiveSubscription(ctx: RequestContext, organizationId: string) {
  await requirePermission(ctx, "billing.read", orgChain(organizationId));
  return db().subscription.findFirst({
    where: { organizationId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    include: { plan: true, items: { include: { priceVersion: true } } },
    orderBy: { createdAt: "desc" },
  });
}
