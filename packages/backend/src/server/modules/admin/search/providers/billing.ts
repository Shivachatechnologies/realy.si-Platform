import { db } from "@/server/core/db";
import { canPlatform, isUuid } from "../../access";
import { ciContains, defineSearchProvider } from "../types";

const STRIPE_ID = /^(sub|in|ch|pi|re|dp|du|cus)_[A-Za-z0-9]{4,}$/;

/**
 * Stream D: subscriptions (organization name / slug, local or Stripe subscription id), invoices (number, Stripe id),
 * payments (Stripe charge / payment intent id), plans (key / name) and promotions (name, coupon code).
 */
export const billingSearch = defineSearchProvider({
  group: "billing",
  perms: ["pricing.read", "platform.subscriptions.read"],
  empty: {
    subscriptions: [] as { id: string; status: string; organization: { name: string }; plan: { name: string } }[],
    invoices: [] as { id: string; number: string | null; status: string; stripeInvoiceId: string; currency: string; totalMinor: string }[],
    payments: [] as { id: string; status: string; stripeChargeId: string | null; currency: string; amountMinor: string }[],
    plans: [] as { id: string; key: string; name: string; status: string }[],
    promotions: [] as { id: string; name: string; codes: string[] }[],
  },
  async search(ctx, q) {
    const subs = await canPlatform(ctx, "platform.subscriptions.read");
    const ci = ciContains(q);
    const stripeId = STRIPE_ID.test(q);
    const uuid = isUuid(q);
    const [subscriptions, invoices, payments, plans, promotions] = await Promise.all([
      subs
        ? db().subscription.findMany({
            where: uuid ? { id: q } : stripeId ? { stripeSubscriptionId: q } : { organization: { OR: [{ name: ci }, { slug: ci }] } },
            take: 8,
            orderBy: { createdAt: "desc" },
            select: { id: true, status: true, organization: { select: { name: true } }, plan: { select: { name: true } } },
          })
        : [],
      subs
        ? db().platformInvoice.findMany({
            where: uuid ? { id: q } : stripeId ? { OR: [{ stripeInvoiceId: q }, { stripeCustomerId: q }, { stripeSubscriptionId: q }] } : { number: ci },
            take: 8,
            orderBy: { createdAt: "desc" },
            select: { id: true, number: true, status: true, stripeInvoiceId: true, currency: true, totalMinor: true },
          })
        : [],
      subs && (stripeId || uuid)
        ? db().platformPayment.findMany({
            where: uuid ? { id: q } : { OR: [{ stripeChargeId: q }, { stripePaymentIntentId: q }, { stripeCustomerId: q }] },
            take: 8,
            orderBy: { createdAt: "desc" },
            select: { id: true, status: true, stripeChargeId: true, currency: true, amountMinor: true },
          })
        : [],
      db().plan.findMany({ where: { OR: [{ key: ci }, { name: ci }] }, take: 8, orderBy: { sortOrder: "asc" }, select: { id: true, key: true, name: true, status: true } }),
      db().promotion.findMany({ where: { OR: [{ name: ci }, { coupons: { some: { code: ci } } }] }, take: 8, orderBy: { createdAt: "desc" }, select: { id: true, name: true, coupons: { select: { code: true } } } }),
    ]);
    return {
      subscriptions,
      invoices: invoices.map((i) => ({ ...i, totalMinor: i.totalMinor.toString() })),
      payments: payments.map((p) => ({ ...p, amountMinor: p.amountMinor.toString() })),
      plans,
      promotions: promotions.map((p) => ({ id: p.id, name: p.name, codes: p.coupons.map((c) => c.code) })),
    };
  },
});
