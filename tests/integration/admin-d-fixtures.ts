import Stripe from "stripe";
import { db } from "@/server/core/db";
import type { PaymentGateway } from "@/server/modules/billing/gateway";
import { upsertBillingProfile } from "@/server/modules/billing/service";
import { createOrganization } from "@/server/modules/organizations/service";
import { PLATFORM_ID } from "@/server/modules/rbac/scope";
import { grant, makeUser } from "../helpers";

export const WEBHOOK_SECRET = "whsec_admin_d_test_secret";

/** Stream D's own tables are not in resetDb's list (other streams own helpers.ts): clear them per test file. */
export async function clearStreamDTables() {
  await db().$executeRawUnsafe(`TRUNCATE "platform_invoices", "platform_payments", "platform_refunds", "platform_disputes", "mrr_snapshots", "platform_daily_metrics", "credit_ledger_entries", "quota_events"`);
}

let n = 0;
export const uid = (p: string) => `${p}_${Date.now().toString(36)}${++n}`;

/** Stripe double for the admin actions: records calls, returns Stripe-shaped refund objects. Never a real call. */
export function adminGateway() {
  const calls: { op: string; args: unknown[] }[] = [];
  const pages = new Map<string, Record<string, unknown>[]>();
  const fail = { refund: false };
  const rec = (op: string) => async (...args: unknown[]) => {
    calls.push({ op, args });
  };
  const gateway: PaymentGateway = {
    createCustomer: async () => uid("cus"),
    createProduct: async () => uid("prod"),
    createPrice: async () => uid("price"),
    createCoupon: async () => uid("coupon"),
    createCheckoutSession: async () => ({ id: uid("cs"), url: "https://checkout.stripe.test/x" }),
    expireCheckoutSession: async () => "expired",
    listOpenCheckoutSessions: async () => [],
    listUnendedSubscriptions: async () => [],
    createPortalSession: async () => ({ url: "https://billing.stripe.test/p" }),
    retrieveSubscription: async (id) => ({ id, customerId: "cus_x", status: "active", metadata: {}, cancelAtPeriodEnd: false, canceledAt: null, trialEnd: null, pauseCollection: null, items: [] }),
    setCancelAtPeriodEnd: rec("setCancelAtPeriodEnd") as PaymentGateway["setCancelAtPeriodEnd"],
    setPauseCollection: rec("setPauseCollection") as PaymentGateway["setPauseCollection"],
    setTrialEnd: rec("setTrialEnd") as PaymentGateway["setTrialEnd"],
    cancelSubscriptionNow: rec("cancelSubscriptionNow") as PaymentGateway["cancelSubscriptionNow"],
    applySubscriptionCoupon: rec("applySubscriptionCoupon") as PaymentGateway["applySubscriptionCoupon"],
    async createRefund(a, key) {
      calls.push({ op: "createRefund", args: [a, key] });
      if (fail.refund) throw new Error("Stripe: charge already refunded");
      return { id: uid("re"), object: "refund", charge: a.chargeId, amount: Number(a.amountMinor), currency: "usd", status: "succeeded", reason: a.reason, metadata: a.metadata, created: Math.floor(Date.now() / 1000) };
    },
    async listStripeObjects(kind, a) {
      calls.push({ op: "list", args: [kind, a] });
      const all = pages.get(kind) ?? [];
      const start = a.startingAfter ? all.findIndex((o) => o.id === a.startingAfter) + 1 : 0;
      const data = all.slice(start, start + a.limit);
      return { data, hasMore: start + a.limit < all.length };
    },
  };
  return { gateway, calls, pages, fail };
}

export function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  return { payload, signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) };
}

let evt = 0;
export const event = (type: string, object: Record<string, unknown>, created = Math.floor(Date.now() / 1000)) => ({ id: `evt_d_${Date.now()}_${++evt}`, object: "event", type, created, livemode: false, data: { object } });

/** An organization with a confirmed billing profile and a Stripe customer id. */
export async function billedOrg(country = "US") {
  const owner = await makeUser({ countryCode: country });
  const org = await createOrganization(owner.ctx, { name: `Billed ${Math.random().toString(36).slice(2, 7)}` });
  await upsertBillingProfile(owner.ctx, org.id, { billingCountryCode: country, confirmCountry: true });
  const customerId = uid("cus");
  await db().billingProfile.update({ where: { organizationId: org.id }, data: { stripeCustomerId: customerId } });
  return { owner, org, customerId };
}

/** A live subscription row as the webhook would have written it (plan "growth", USD global monthly price). */
export async function liveSubscription(organizationId: string, opts: { status?: "ACTIVE" | "TRIALING" | "PAST_DUE"; planKey?: string } = {}) {
  const version = await db().priceVersion.findFirstOrThrow({ where: { price: { plan: { key: opts.planKey ?? "growth" }, interval: "MONTH", marketType: "GLOBAL" } }, orderBy: { version: "desc" }, include: { price: true } });
  return db().subscription.create({
    data: {
      organizationId,
      planId: version.price.planId,
      status: opts.status ?? "ACTIVE",
      currency: version.currency,
      billingCountryCode: "US",
      interval: "MONTH",
      currentPeriodStart: new Date(Date.now() - 5 * 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 25 * 86_400_000),
      trialEndsAt: opts.status === "TRIALING" ? new Date(Date.now() + 3 * 86_400_000) : null,
      stripeSubscriptionId: uid("sub"),
      items: { create: { priceVersionId: version.id, quantity: 1, unitAmountMinor: version.amountMinor, currency: version.currency, stripeSubscriptionItemId: uid("si") } },
    },
    include: { items: true },
  });
}

export async function platformAdmin(role: "SUPER_ADMIN" | "BILLING_ADMIN" | "FINANCE_ADMIN", opts: { mfa?: boolean } = {}) {
  const u = await makeUser({ name: role, mfa: opts.mfa });
  await grant(u.user.id, role, "PLATFORM", PLATFORM_ID);
  return u;
}
