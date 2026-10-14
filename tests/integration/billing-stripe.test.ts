import { afterEach, beforeAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { db } from "@/server/core/db";
import { setBillingConfigForTests, type GatewaySubscription, type PaymentGateway } from "@/server/modules/billing/gateway";
import { createCheckoutSession, createPortalSession, handleStripeWebhook } from "@/server/modules/billing/stripe-billing";
import { upsertBillingProfile } from "@/server/modules/billing/service";
import { createOrganization } from "@/server/modules/organizations/service";
import { createPromotion, resolvePrice, schedulePriceChange } from "@/server/modules/pricing/service";
import { expectCode, grant, makeUser, resetDb } from "../helpers";

const WEBHOOK_SECRET = "whsec_test_secret_for_signature_verification";

// Stripe ids are globally unique; keep the counter global across gateway doubles.
let n = 0;

/** Recording Stripe double. Creates unique ids and honors idempotency keys like Stripe does. */
function recordingGateway() {
  const calls: { op: string; args: unknown }[] = [];
  const byKey = new Map<string, string>();
  const subs = new Map<string, GatewaySubscription>();
  const create = (op: string, prefix: string) => async (args: unknown, key: string) => {
    calls.push({ op, args });
    if (!byKey.has(key)) byKey.set(key, `${prefix}_${++n}`);
    return byKey.get(key)!;
  };
  const gateway: PaymentGateway = {
    createCustomer: create("customer", "cus"),
    createProduct: create("product", "prod"),
    createPrice: create("price", "price"),
    createCoupon: create("coupon", "coupon"),
    async createCheckoutSession(args) {
      calls.push({ op: "checkout", args });
      return { id: `cs_${++n}`, url: `https://checkout.stripe.test/c/cs_${n}` };
    },
    async createPortalSession(args) {
      calls.push({ op: "portal", args });
      return { url: "https://billing.stripe.test/p/session" };
    },
    async retrieveSubscription(id) {
      const s = subs.get(id);
      if (!s) throw new Error(`no such subscription ${id}`);
      return s;
    },
  };
  return { gateway, calls, subs };
}

function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  return { payload, signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) };
}

let evt = 0;
const event = (type: string, object: Record<string, unknown>) => ({ id: `evt_${Date.now()}_${++evt}`, object: "event", type, livemode: false, data: { object } });

beforeAll(resetDb);
afterEach(() => setBillingConfigForTests(undefined));

async function orgWithConfirmedCountry(country = "IN") {
  const { user, ctx } = await makeUser({ countryCode: country });
  const org = await createOrganization(ctx, { name: `Billing ${Math.random().toString(36).slice(2, 7)}` });
  await upsertBillingProfile(ctx, org.id, { billingCountryCode: country, confirmCountry: true });
  return { user, ctx, org };
}

describe("billing not configured", () => {
  it("checkout and webhooks say so truthfully", async () => {
    setBillingConfigForTests(null);
    const { ctx, org } = await orgWithConfirmedCountry();
    const err = await expectCode(createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" }), "not_configured");
    expect((err as Error).message).toBe("Billing is not configured.");
    expect((await handleStripeWebhook("{}", "t=1,v1=x")).status).toBe(501);
  });
});

describe("checkout", () => {
  it("is derived from the server-side regional quote and mirrors catalog objects lazily, once", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { ctx, org } = await orgWithConfirmedCountry("IN");
    const r = await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH", locale: "hi-IN" });
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);

    const price = g.calls.find((c) => c.op === "price")!.args as { amountMinor: bigint; currency: string; interval: string };
    expect(price).toMatchObject({ amountMinor: 499900n, currency: "INR", interval: "month" });
    const checkout = g.calls.find((c) => c.op === "checkout")!.args as { metadata: Record<string, string>; trialDays: number; successUrl: string };
    const resolved = await resolvePrice(db(), { planKey: "founder", interval: "MONTH", countryCode: "IN" });
    expect(checkout.metadata).toEqual({ organizationId: org.id, priceVersionId: resolved.available ? resolved.price.priceVersionId : "", billingCountryCode: "IN" });
    expect(checkout.trialDays).toBe(14);
    expect(checkout.successUrl).toMatch(/\/hi-IN\/settings\/billing\?checkout=success$/);

    const profile = await db().billingProfile.findUniqueOrThrow({ where: { organizationId: org.id } });
    expect(profile.stripeCustomerId).toMatch(/^cus_/);
    const version = await db().priceVersion.findUniqueOrThrow({ where: { id: checkout.metadata.priceVersionId } });
    expect(version.stripePriceId).toMatch(/^price_/);

    // A second checkout reuses the customer/product/price (no duplicate Stripe objects).
    const before = g.calls.filter((c) => c.op !== "checkout").length;
    await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    expect(g.calls.filter((c) => c.op !== "checkout").length).toBe(before);
    expect(await db().auditLog.count({ where: { organizationId: org.id, action: "billing.checkout_started" } })).toBe(2);
  });

  it("requires a confirmed billing country and refuses a different one", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { ctx } = await makeUser();
    const org = await createOrganization(ctx, { name: "No country" });
    await expectCode(createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" }), "validation_error");
    await upsertBillingProfile(ctx, org.id, { billingCountryCode: "AE", confirmCountry: true });
    await expectCode(createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH", billingCountryCode: "US" }), "validation_error");
  });

  it("maps a valid coupon to a Stripe coupon", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: true });
    const { user: admin, ctx: adminCtx } = await makeUser();
    await grant(admin.id, "PLATFORM_ADMIN", "PLATFORM", "*");
    await createPromotion(adminCtx, { name: "AE launch", discountType: "PERCENT", percentOffBps: 2000, countryCodes: ["AE"], startsAt: new Date(Date.now() - 1000), couponCode: "AE20", reason: "launch" });
    const { ctx, org } = await orgWithConfirmedCountry("AE");
    await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH", couponCode: "AE20" });
    expect(g.calls.find((c) => c.op === "coupon")!.args).toMatchObject({ percentOffBps: 2000 });
    expect(g.calls.find((c) => c.op === "checkout")!.args).toMatchObject({ couponId: expect.stringMatching(/^coupon_/), automaticTax: true });
  });

  it("only billing managers can start checkout or open the portal", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { org } = await orgWithConfirmedCountry();
    const outsider = await makeUser();
    await expectCode(createCheckoutSession(outsider.ctx, org.id, { planKey: "founder", interval: "MONTH" }), "not_found");
    await expectCode(createPortalSession(outsider.ctx, org.id), "not_found");
  });
});

describe("webhooks", () => {
  async function subscribedOrg() {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { ctx, org } = await orgWithConfirmedCountry("IN");
    await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    const checkout = g.calls.find((c) => c.op === "checkout")!.args as { customerId: string; priceId: string; metadata: Record<string, string> };
    const subId = `sub_${++n}`;
    const now = Math.floor(Date.now() / 1000);
    g.subs.set(subId, {
      id: subId,
      customerId: checkout.customerId,
      status: "active",
      metadata: checkout.metadata,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      trialEnd: null,
      items: [{ id: `si_${++n}`, priceId: checkout.priceId, quantity: 1, currentPeriodStart: now, currentPeriodEnd: now + 30 * 86400 }],
    });
    return { g, ctx, org, subId, checkout };
  }

  it("rejects missing and invalid signatures without recording anything", async () => {
    setBillingConfigForTests({ gateway: recordingGateway().gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const e = event("checkout.session.completed", {});
    expect((await handleStripeWebhook(JSON.stringify(e), null)).status).toBe(400);
    const forged = Stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify(e), secret: "whsec_attacker" });
    expect((await handleStripeWebhook(JSON.stringify(e), forged)).status).toBe(400);
    const tampered = signed(e);
    expect((await handleStripeWebhook(tampered.payload.replace("checkout", "checkoutX"), tampered.signature)).status).toBe(400);
    expect(await db().stripeEvent.count({ where: { id: e.id } })).toBe(0);
  });

  it("activates exactly once from checkout.session.completed, locked to the sold price version", async () => {
    const { org, subId, checkout } = await subscribedOrg();
    const e = event("checkout.session.completed", { id: "cs_x", object: "checkout.session", mode: "subscription", subscription: subId });
    const { payload, signature } = signed(e);
    const r1 = await handleStripeWebhook(payload, signature);
    const r2 = await handleStripeWebhook(payload, signature);
    expect(r1).toEqual({ status: 200, body: { received: true, outcome: "applied" } });
    expect(r2.body).toMatchObject({ duplicate: true });
    const subs = await db().subscription.findMany({ where: { organizationId: org.id }, include: { items: true } });
    expect(subs).toHaveLength(1);
    expect(subs[0]!.status).toBe("ACTIVE");
    expect(subs[0]!.items[0]!.priceVersionId).toBe(checkout.metadata.priceVersionId);
    expect(subs[0]!.items[0]!.unitAmountMinor).toBe(499900n);
    expect(await db().auditLog.count({ where: { organizationId: org.id, action: "billing.subscription.created" } })).toBe(1);
  });

  it("tracks the lifecycle: payment failure, recovery, cancellation (using current state, safe out of order)", async () => {
    const { g, org, subId } = await subscribedOrg();
    const deliver = async (type: string, object: Record<string, unknown>) => {
      const { payload, signature } = signed(event(type, object));
      return handleStripeWebhook(payload, signature);
    };
    await deliver("customer.subscription.created", { id: subId, object: "subscription" });

    g.subs.get(subId)!.status = "past_due";
    await deliver("invoice.payment_failed", { id: "in_1", object: "invoice", parent: { subscription_details: { subscription: subId } } });
    let s = await db().subscription.findUniqueOrThrow({ where: { stripeSubscriptionId: subId } });
    expect(s.status).toBe("PAST_DUE");
    expect(s.lastPaymentFailedAt).not.toBeNull();

    g.subs.get(subId)!.status = "active";
    await deliver("invoice.paid", { id: "in_2", object: "invoice", subscription: subId }); // pre-basil shape
    s = await db().subscription.findUniqueOrThrow({ where: { stripeSubscriptionId: subId } });
    expect(s.status).toBe("ACTIVE");
    expect(s.lastPaymentSucceededAt).not.toBeNull();

    g.subs.get(subId)!.status = "canceled";
    g.subs.get(subId)!.canceledAt = Math.floor(Date.now() / 1000);
    await deliver("customer.subscription.deleted", { id: subId, object: "subscription" });
    // A stale "updated" event arriving late must not resurrect it: state is re-fetched from Stripe.
    await deliver("customer.subscription.updated", { id: subId, object: "subscription", status: "active" });
    s = await db().subscription.findUniqueOrThrow({ where: { stripeSubscriptionId: subId } });
    expect(s.status).toBe("CANCELED");
    expect(s.canceledAt).not.toBeNull();
    expect(await db().subscription.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("a processing failure is not acknowledged as a duplicate (Stripe must retry)", async () => {
    const { g, subId } = await subscribedOrg();
    const other = await subscribedOrg();
    // Force a unique violation unrelated to the event ledger: reuse another subscription's item id.
    const ok = signed(event("customer.subscription.created", { id: other.subId }));
    await handleStripeWebhook(ok.payload, ok.signature);
    g.subs.get(subId)!.items[0]!.id = other.g.subs.get(other.subId)!.items[0]!.id;
    const e = event("customer.subscription.created", { id: subId });
    const bad = signed(e);
    await expect(handleStripeWebhook(bad.payload, bad.signature)).rejects.toThrow();
    expect(await db().stripeEvent.count({ where: { id: e.id } })).toBe(0); // not recorded → Stripe's retry will be processed
  });

  it("refuses a subscription whose customer does not belong to the organization in its metadata", async () => {
    const { g, subId } = await subscribedOrg();
    const victim = await orgWithConfirmedCountry("US");
    g.subs.get(subId)!.metadata = { ...g.subs.get(subId)!.metadata, organizationId: victim.org.id };
    const { payload, signature } = signed(event("customer.subscription.created", { id: subId }));
    const r = await handleStripeWebhook(payload, signature);
    expect(r.body).toMatchObject({ outcome: "customer_mismatch" });
    expect(await db().subscription.count({ where: { organizationId: victim.org.id } })).toBe(0);
  });

  it("a later India price change leaves the live subscription at its historical price", async () => {
    const { org, subId } = await subscribedOrg();
    const { payload, signature } = signed(event("customer.subscription.created", { id: subId }));
    await handleStripeWebhook(payload, signature);
    const { user: admin, ctx: adminCtx } = await makeUser();
    await grant(admin.id, "COUNTRY_ADMIN", "COUNTRY", "IN");
    const inPrice = await db().price.findFirstOrThrow({ where: { plan: { key: "founder" }, marketCode: "IN", interval: "MONTH" } });
    await schedulePriceChange(adminCtx, inPrice.id, { amountMinor: 599900, reason: "billing test" });
    const s = await db().subscription.findFirstOrThrow({ where: { organizationId: org.id }, include: { items: true } });
    expect(s.items[0]!.unitAmountMinor).toBe(499900n);
  });

  it("blocks a second checkout while subscribed, and opens the portal for the customer", async () => {
    const { ctx, org, subId } = await subscribedOrg();
    const { payload, signature } = signed(event("customer.subscription.created", { id: subId }));
    await handleStripeWebhook(payload, signature);
    await expectCode(createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" }), "conflict");
    expect((await createPortalSession(ctx, org.id, "de-DE")).url).toMatch(/^https:\/\/billing\.stripe\.test/);
  });
});
