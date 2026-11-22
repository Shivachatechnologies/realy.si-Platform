import { afterEach, beforeAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { db } from "@/server/core/db";
import { setBillingConfigForTests, type GatewaySubscription, type PaymentGateway } from "@/server/modules/billing/gateway";
import { createCheckoutSession, handleStripeWebhook } from "@/server/modules/billing/stripe-billing";
import { upsertBillingProfile } from "@/server/modules/billing/service";
import { getEntitlements, invalidateEntitlements } from "@/server/modules/entitlements/service";
import { createOrganization } from "@/server/modules/organizations/service";
import { makeUser, resetDb } from "../helpers";

// B19: a failed Stripe payment reaches the customer in the app (notification + billing banner data), never simulated:
// state changes only on signed webhooks; the gateway below is a test double of Stripe's API.

const SECRET = "whsec_g6_billing_notice_test";
let n = 0;

function gatewayDouble() {
  const calls: { op: string; args: unknown }[] = [];
  const byKey = new Map<string, string>();
  const subs = new Map<string, GatewaySubscription>();
  const create = (op: string, prefix: string) => async (args: unknown, key: string) => {
    calls.push({ op, args });
    if (!byKey.has(key)) byKey.set(key, `${prefix}_g6_${++n}`);
    return byKey.get(key)!;
  };
  const gateway: PaymentGateway = {
    createCustomer: create("customer", "cus"),
    createProduct: create("product", "prod"),
    createPrice: create("price", "price"),
    createCoupon: create("coupon", "coupon"),
    async createCheckoutSession(args, key) {
      calls.push({ op: "checkout", args });
      if (!byKey.has(key)) byKey.set(key, `cs_g6_${++n}`);
      return { id: byKey.get(key)!, url: `https://checkout.stripe.test/c/${byKey.get(key)}` };
    },
    async expireCheckoutSession() {
      return "expired";
    },
    async listOpenCheckoutSessions() {
      return [];
    },
    async listUnendedSubscriptions() {
      return [];
    },
    async createPortalSession() {
      return { url: "https://billing.stripe.test/p" };
    },
    async retrieveSubscription(id) {
      const s = subs.get(id);
      if (!s) throw new Error(`no such subscription ${id}`);
      return s;
    },
  };
  return { gateway, calls, subs };
}

let evt = 0;
async function deliver(type: string, object: Record<string, unknown>) {
  const payload = JSON.stringify({ id: `evt_g6_${Date.now()}_${++evt}`, object: "event", type, livemode: false, data: { object } });
  return handleStripeWebhook(payload, Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }));
}

beforeAll(resetDb);
afterEach(() => setBillingConfigForTests(undefined));

describe("failed payment notice", () => {
  it("notifies billing managers on failure and on recovery, and exposes the dates for the banner", async () => {
    const g = gatewayDouble();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: SECRET, automaticTax: false });
    const { user, ctx } = await makeUser({ countryCode: "IN" });
    const org = await createOrganization(ctx, { name: `Notice ${Math.random().toString(36).slice(2, 7)}` });
    await upsertBillingProfile(ctx, org.id, { billingCountryCode: "IN", confirmCountry: true });
    await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    const checkout = g.calls.find((c) => c.op === "checkout")!.args as { customerId: string; priceId: string; metadata: Record<string, string> };
    const subId = `sub_g6_${++n}`;
    const now = Math.floor(Date.now() / 1000);
    g.subs.set(subId, { id: subId, customerId: checkout.customerId, status: "active", metadata: checkout.metadata, cancelAtPeriodEnd: false, canceledAt: null, trialEnd: null, items: [{ id: `si_g6_${++n}`, priceId: checkout.priceId, quantity: 1, currentPeriodStart: now, currentPeriodEnd: now + 30 * 86400 }] });
    await deliver("customer.subscription.created", { id: subId, object: "subscription" });
    expect(await db().notification.count({ where: { organizationId: org.id, type: { startsWith: "billing." } } })).toBe(0);

    g.subs.get(subId)!.status = "past_due";
    await deliver("invoice.payment_failed", { id: "in_g6_1", object: "invoice", parent: { subscription_details: { subscription: subId } } });
    const failed = await db().notification.findMany({ where: { organizationId: org.id, type: "billing.payment_failed" } });
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ userId: user.id, payload: { title: org.name, href: "/settings/billing" } });
    invalidateEntitlements(org.id);
    const ent = await getEntitlements(org.id);
    expect(ent.state).toBe("past_due");
    expect(ent.subscription?.lastPaymentFailedAt).toBeInstanceOf(Date);

    g.subs.get(subId)!.status = "active";
    await deliver("invoice.paid", { id: "in_g6_2", object: "invoice", subscription: subId });
    expect(await db().notification.count({ where: { organizationId: org.id, type: "billing.payment_recovered" } })).toBe(1);
    // A further routine payment is not a "recovery".
    await deliver("invoice.paid", { id: "in_g6_3", object: "invoice", subscription: subId });
    expect(await db().notification.count({ where: { organizationId: org.id, type: "billing.payment_recovered" } })).toBe(1);
  });
});
