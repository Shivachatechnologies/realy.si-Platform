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
  type CheckoutArgs = Parameters<PaymentGateway["createCheckoutSession"]>[0];
  const sessions = new Map<string, { customerId: string; status: "open" | "complete" | "expired"; args: CheckoutArgs; createdAt: number }>();
  let failNextCheckoutAfterCreate = false;
  let hold: Promise<void> | null = null;
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
    async createCheckoutSession(args, key) {
      calls.push({ op: "checkout", args });
      if (!byKey.has(key)) {
        const id = `cs_${++n}`;
        byKey.set(key, id);
        sessions.set(id, { customerId: args.customerId, status: "open", args, createdAt: Date.now() });
      }
      const id = byKey.get(key)!;
      if (hold) {
        const h = hold;
        hold = null;
        await h; // a slow Stripe: the session exists, the response hasn't arrived yet
      }
      if (failNextCheckoutAfterCreate) {
        failNextCheckoutAfterCreate = false;
        throw new Error("network error after Stripe created the session");
      }
      return { id, url: `https://checkout.stripe.test/c/${id}` };
    },
    async expireCheckoutSession(id) {
      calls.push({ op: "expire", args: id });
      const session = sessions.get(id);
      if (!session) throw new Error(`no such session ${id}`);
      if (session.status === "open") session.status = "expired";
      return session.status as "expired" | "complete";
    },
    async listOpenCheckoutSessions(customerId) {
      return [...sessions].filter(([, v]) => v.customerId === customerId && v.status === "open").map(([k]) => k);
    },
    async listUnendedSubscriptions(customerId) {
      return [...subs.values()].filter((x) => x.customerId === customerId && x.status !== "canceled" && x.status !== "incomplete_expired").map((x) => x.id);
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
  return {
    gateway,
    calls,
    subs,
    sessions,
    /** The customer pays on Stripe's page: Stripe completes the session and creates the subscription. Realy learns of it only from webhooks. */
    pay: (id: string) => {
      const session = sessions.get(id)!;
      session.status = "complete";
      const subId = `sub_${++n}`;
      const now = Math.floor(Date.now() / 1000);
      subs.set(subId, {
        id: subId,
        customerId: session.customerId,
        status: "trialing",
        metadata: session.args.metadata,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEnd: now + 14 * 86400,
        items: [{ id: `si_${++n}`, priceId: session.args.priceId, quantity: 1, currentPeriodStart: now, currentPeriodEnd: now + 30 * 86400 }],
      });
      return subId;
    },
    /** Make the next createCheckoutSession hang after Stripe created the session; returns the release. */
    holdNextCheckout: () => {
      let release!: () => void;
      hold = new Promise<void>((r) => (release = r));
      return release;
    },
    /** Simulate a crash/timeout after Stripe created the session but before Realy stored its id. */
    failNextCheckoutAfterCreate: () => (failNextCheckoutAfterCreate = true),
  };
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
    expect(checkout.metadata).toEqual({
      organizationId: org.id,
      priceVersionId: resolved.available ? resolved.price.priceVersionId : "",
      billingCountryCode: "IN",
      checkoutId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(checkout.trialDays).toBe(14);
    expect(checkout.successUrl).toMatch(/\/hi-IN\/settings\/billing\?checkout=success$/);

    const profile = await db().billingProfile.findUniqueOrThrow({ where: { organizationId: org.id } });
    expect(profile.stripeCustomerId).toMatch(/^cus_/);
    const version = await db().priceVersion.findUniqueOrThrow({ where: { id: checkout.metadata.priceVersionId } });
    expect(version.stripePriceId).toMatch(/^price_/);

    // Asking again for the same plan returns the same open session: no second payable session, no new Stripe objects.
    const callsBefore = g.calls.length;
    const again = await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    expect(again.url).toBe(r.url);
    expect(g.calls.length).toBe(callsBefore);
    expect(await db().auditLog.count({ where: { organizationId: org.id, action: "billing.checkout_started" } })).toBe(1);
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

  it("concurrent deliveries of the same event apply it exactly once", async () => {
    const { org, subId } = await subscribedOrg();
    const e = event("checkout.session.completed", { id: "cs_c", object: "checkout.session", mode: "subscription", subscription: subId });
    const { payload, signature } = signed(e);
    const results = await Promise.all(Array.from({ length: 6 }, () => handleStripeWebhook(payload, signature)));
    expect(results.filter((r) => r.status === 200 && (r.body as { outcome?: string }).outcome === "applied")).toHaveLength(1);
    // Every other delivery is either acknowledged as a duplicate or refused for Stripe to retry; none re-applies.
    for (const r of results) expect([200, 500]).toContain(r.status);
    expect(await db().subscription.count({ where: { organizationId: org.id } })).toBe(1);
    expect(await db().stripeEvent.count({ where: { id: e.id } })).toBe(1);
    expect(await db().auditLog.count({ where: { organizationId: org.id, action: "billing.subscription.created" } })).toBe(1);
  });

  it("refuses a validly signed event replayed outside the signature tolerance window", async () => {
    setBillingConfigForTests({ gateway: recordingGateway().gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const payload = JSON.stringify(event("checkout.session.completed", {}));
    const stale = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET, timestamp: Math.floor(Date.now() / 1000) - 3600 });
    expect((await handleStripeWebhook(payload, stale)).status).toBe(400);
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

describe("double-billing protection", () => {
  type CheckoutArgs = { customerId: string; priceId: string; metadata: Record<string, string> };
  const lastCheckout = (g: ReturnType<typeof recordingGateway>) => g.calls.filter((c) => c.op === "checkout").at(-1)!.args as CheckoutArgs;
  const sessionIdOf = (url: string) => url.split("/").at(-1)!;

  /** Stripe-side subscription produced by paying a checkout session (what Stripe would send us). */
  function stripeSubscriptionFor(g: ReturnType<typeof recordingGateway>, args: CheckoutArgs, status = "active") {
    const subId = `sub_${++n}`;
    const now = Math.floor(Date.now() / 1000);
    g.subs.set(subId, {
      id: subId,
      customerId: args.customerId,
      status,
      metadata: args.metadata,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      trialEnd: null,
      items: [{ id: `si_${++n}`, priceId: args.priceId, quantity: 1, currentPeriodStart: now, currentPeriodEnd: now + 30 * 86400 }],
    });
    return subId;
  }
  const deliver = async (type: string, object: Record<string, unknown>) => {
    const { payload, signature } = signed(event(type, object));
    return handleStripeWebhook(payload, signature);
  };

  it("concurrent checkout requests create exactly one payable Stripe session", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { ctx, org } = await orgWithConfirmedCountry("IN");
    // A second billing manager in another tab, plus double clicks.
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" })));
    const ok = results.filter((r): r is PromiseFulfilledResult<{ url: string }> => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of refused) expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "conflict", details: { reason: "checkout_in_progress" } });
    expect(new Set(ok.map((r) => r.value.url)).size).toBe(1); // everyone who got a URL got the same session
    expect(g.calls.filter((c) => c.op === "checkout")).toHaveLength(1);
    expect(await db().checkoutSession.count({ where: { organizationId: org.id, status: "OPEN" } })).toBe(1);
    const customer = (await db().billingProfile.findUniqueOrThrow({ where: { organizationId: org.id } })).stripeCustomerId!;
    expect(await g.gateway.listOpenCheckoutSessions(customer)).toHaveLength(1);
  });

  it("the database refuses a second OPEN checkout or a second live subscription for one organization", async () => {
    const { org } = await orgWithConfirmedCountry("IN");
    const version = await db().priceVersion.findFirstOrThrow();
    const expiresAt = new Date(Date.now() + 60_000);
    await db().checkoutSession.create({ data: { organizationId: org.id, priceVersionId: version.id, expiresAt } });
    await expect(db().checkoutSession.create({ data: { organizationId: org.id, priceVersionId: version.id, expiresAt } })).rejects.toMatchObject({ code: "P2002" });
    const plan = await db().plan.findFirstOrThrow();
    const live = { organizationId: org.id, planId: plan.id, status: "ACTIVE" as const, currency: "INR", billingCountryCode: "IN", interval: "MONTH" as const };
    await db().subscription.create({ data: { ...live, stripeSubscriptionId: `sub_${++n}` } });
    await expect(db().subscription.create({ data: { ...live, stripeSubscriptionId: `sub_${++n}` } })).rejects.toMatchObject({ code: "P2002" });
    // Ended subscriptions don't count.
    await db().subscription.create({ data: { ...live, status: "CANCELED", stripeSubscriptionId: `sub_${++n}` } });
  });

  it("switching plan expires the open session at Stripe before creating a new one", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { ctx, org } = await orgWithConfirmedCountry("IN");
    const monthly = await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    const yearly = await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "YEAR" });
    expect(yearly.url).not.toBe(monthly.url);
    expect(g.sessions.get(sessionIdOf(monthly.url))!.status).toBe("expired");
    expect(g.sessions.get(sessionIdOf(yearly.url))!.status).toBe("open");
    const rows = await db().checkoutSession.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["EXPIRED", "OPEN"]);
  });

  it("payment completion race: if the customer already paid the open session, no new session is created", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { ctx, org } = await orgWithConfirmedCountry("IN");
    const monthly = await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    g.pay(sessionIdOf(monthly.url)); // paid on Stripe; the webhook has not arrived yet
    const err = await expectCode(createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "YEAR" }), "conflict");
    expect(err).toMatchObject({ details: { reason: "payment_processing" } });
    expect(g.calls.filter((c) => c.op === "checkout")).toHaveLength(1);
    expect((await db().checkoutSession.findFirstOrThrow({ where: { organizationId: org.id } })).status).toBe("COMPLETED");
    // Asking again (no OPEN row, webhook still not applied): Stripe's own record of the subscription blocks it.
    const again = await expectCode(createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "YEAR" }), "conflict");
    expect(again).toMatchObject({ details: { reason: "payment_processing" } });
    expect(g.calls.filter((c) => c.op === "checkout")).toHaveLength(1);
    expect(await db().checkoutSession.count({ where: { organizationId: org.id, status: "OPEN" } })).toBe(0);
    // The redirect back to Realy changes nothing: there is no subscription until a verified webhook arrives.
    expect(await db().subscription.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("a session orphaned by a crash between Stripe and the database is expired before a new one is created", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { ctx, org } = await orgWithConfirmedCountry("IN");
    g.failNextCheckoutAfterCreate();
    await expect(createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" })).rejects.toThrow(/network error/);
    const orphan = [...g.sessions.keys()][0]!;
    expect(g.sessions.get(orphan)!.status).toBe("open"); // payable at Stripe, unknown to Realy
    expect((await db().checkoutSession.findFirstOrThrow({ where: { organizationId: org.id } })).status).toBe("FAILED");

    const retry = await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    expect(g.sessions.get(orphan)!.status).toBe("expired");
    const customer = (await db().billingProfile.findUniqueOrThrow({ where: { organizationId: org.id } })).stripeCustomerId!;
    expect(await g.gateway.listOpenCheckoutSessions(customer)).toEqual([sessionIdOf(retry.url)]);
  });

  it("an orphan the customer already paid blocks a new checkout instead of risking a second charge", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { ctx, org } = await orgWithConfirmedCountry("IN");
    g.failNextCheckoutAfterCreate();
    await expect(createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" })).rejects.toThrow();
    const orphan = [...g.sessions.keys()][0]!;
    // Paid between the failed attempt and the retry; the gateway still lists it as open until Stripe settles.
    const realList = g.gateway.listOpenCheckoutSessions;
    g.gateway.listOpenCheckoutSessions = async () => [orphan];
    g.pay(orphan);
    await expectCode(createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" }), "conflict");
    g.gateway.listOpenCheckoutSessions = realList;
    expect(g.calls.filter((c) => c.op === "checkout")).toHaveLength(1);
    expect(await db().checkoutSession.count({ where: { organizationId: org.id, status: "OPEN" } })).toBe(0);
  });

  it("a request that outlives its reservation (slow Stripe) never returns its session; it expires it instead", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { ctx, org } = await orgWithConfirmedCountry("IN");
    const release = g.holdNextCheckout();
    const slow = createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    // Wait until Stripe has created A's session (its response is held back).
    await expect.poll(() => g.sessions.size).toBe(1);
    const sessionA = [...g.sessions.keys()][0]!;
    // Long enough that A's reservation counts as abandoned; request B takes over.
    await db().checkoutSession.updateMany({ where: { organizationId: org.id, status: "OPEN" }, data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } });
    const fast = await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    expect(g.sessions.get(sessionA)!.status).toBe("expired"); // B retired A's orphan before creating its own
    release();
    await expect(slow).rejects.toMatchObject({ code: "conflict", details: { reason: "checkout_in_progress" } });
    const customer = (await db().billingProfile.findUniqueOrThrow({ where: { organizationId: org.id } })).stripeCustomerId!;
    expect(await g.gateway.listOpenCheckoutSessions(customer)).toEqual([sessionIdOf(fast.url)]);
    expect(await db().checkoutSession.count({ where: { organizationId: org.id, status: "OPEN" } })).toBe(1);
  });

  it("sessions are created with at least Stripe's 30-minute minimum lifetime, measured at the Stripe call", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { ctx, org } = await orgWithConfirmedCountry("IN");
    await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    const [session] = [...g.sessions.values()];
    const lifetime = session!.args.expiresAt.getTime() - session!.createdAt;
    expect(lifetime).toBeGreaterThanOrEqual(30 * 60 * 1000);
    expect(lifetime).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    const row = await db().checkoutSession.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(row.expiresAt.getTime()).toBe(session!.args.expiresAt.getTime());
  });

  it("an expired session releases the lock (Stripe-side expiry or the checkout.session.expired webhook)", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { ctx, org } = await orgWithConfirmedCountry("IN");
    const first = await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    g.sessions.get(sessionIdOf(first.url))!.status = "expired";
    expect((await deliver("checkout.session.expired", { id: sessionIdOf(first.url), object: "checkout.session" })).status).toBe(200);
    expect((await db().checkoutSession.findFirstOrThrow({ where: { organizationId: org.id } })).status).toBe("EXPIRED");
    const second = await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    expect(second.url).not.toBe(first.url);
  });

  it("out-of-order and duplicate webhooks converge: subscription first, checkout completion later, redelivered", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { ctx, org } = await orgWithConfirmedCountry("IN");
    const r = await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    const subId = g.pay(sessionIdOf(r.url));
    // customer.subscription.created overtakes checkout.session.completed.
    expect((await deliver("customer.subscription.created", { id: subId, object: "subscription" })).body).toMatchObject({ outcome: "applied" });
    expect((await db().checkoutSession.findFirstOrThrow({ where: { organizationId: org.id } })).status).toBe("COMPLETED");
    const completed = event("checkout.session.completed", { id: sessionIdOf(r.url), object: "checkout.session", mode: "subscription", subscription: subId });
    const { payload, signature } = signed(completed);
    const results = await Promise.all([handleStripeWebhook(payload, signature), handleStripeWebhook(payload, signature), handleStripeWebhook(payload, signature)]);
    expect(results.filter((x) => x.status === 200 && (x.body as { outcome?: string }).outcome === "applied")).toHaveLength(1);
    expect(await db().subscription.count({ where: { organizationId: org.id } })).toBe(1);
    expect(await db().auditLog.count({ where: { organizationId: org.id, action: "billing.subscription.created" } })).toBe(1);
    // A further checkout is refused while subscribed.
    await expectCode(createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "YEAR" }), "conflict");
  });

  it("a second paid subscription for the same organization is never activated; it is flagged for a human", async () => {
    const g = recordingGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { ctx, org } = await orgWithConfirmedCountry("IN");
    await createCheckoutSession(ctx, org.id, { planKey: "founder", interval: "MONTH" });
    const args = lastCheckout(g);
    const first = stripeSubscriptionFor(g, args);
    await deliver("customer.subscription.created", { id: first, object: "subscription" });
    // E.g. a session created outside Realy (Stripe dashboard) for the same customer and organization.
    const second = stripeSubscriptionFor(g, args);
    const e = event("customer.subscription.created", { id: second, object: "subscription" });
    const { payload, signature } = signed(e);
    const r = await handleStripeWebhook(payload, signature);
    expect(r).toEqual({ status: 200, body: { received: true, outcome: "duplicate_subscription" } }); // acknowledged: no retry storm
    expect(await db().subscription.count({ where: { organizationId: org.id, status: { in: ["ACTIVE", "TRIALING"] } } })).toBe(1);
    expect(await db().subscription.count({ where: { stripeSubscriptionId: second } })).toBe(0);
    expect(await db().auditLog.count({ where: { organizationId: org.id, action: "billing.subscription.duplicate_blocked" } })).toBe(1);
    expect((await db().stripeEvent.findUniqueOrThrow({ where: { id: e.id } })).outcome).toBe("duplicate_subscription");
  });
});
