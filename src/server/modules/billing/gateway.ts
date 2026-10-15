import Stripe from "stripe";
import { env } from "@/server/core/env";

/**
 * The subset of Stripe Realy uses, behind an interface so the billing logic is testable with a recording
 * double. Production uses `stripeGateway` (real Stripe API, server-side only — the secret key never
 * leaves the server). There is no "fake success" mode: without credentials, billing is NOT CONFIGURED.
 */
export interface GatewaySubscription {
  id: string;
  customerId: string;
  status: string;
  metadata: Record<string, string>;
  cancelAtPeriodEnd: boolean;
  canceledAt: number | null;
  trialEnd: number | null;
  items: { id: string; priceId: string; quantity: number; currentPeriodStart: number | null; currentPeriodEnd: number | null }[];
}

export interface PaymentGateway {
  createCustomer(args: { organizationId: string; name: string; email: string | null; country: string }, idempotencyKey: string): Promise<string>;
  createProduct(args: { planKey: string; name: string }, idempotencyKey: string): Promise<string>;
  createPrice(
    args: { productId: string; amountMinor: bigint; currency: string; interval: "month" | "year"; priceVersionId: string },
    idempotencyKey: string,
  ): Promise<string>;
  createCoupon(args: { promotionId: string; name: string; percentOffBps?: number; amountOffMinor?: bigint; currency?: string }, idempotencyKey: string): Promise<string>;
  createCheckoutSession(args: {
    customerId: string;
    priceId: string;
    couponId: string | null;
    trialDays: number;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    automaticTax: boolean;
    locale: string;
    /** When Stripe must stop accepting payment on this session (30 min – 24 h ahead). */
    expiresAt: Date;
  }, idempotencyKey: string): Promise<{ id: string; url: string }>;
  /**
   * Make a checkout session unpayable. Resolves "expired" once it can no longer be paid, or "complete" if
   * the customer already finished paying (Stripe serializes the two, so exactly one of them wins).
   */
  expireCheckoutSession(id: string): Promise<"expired" | "complete">;
  /** Ids of this customer's checkout sessions that can still be paid. */
  listOpenCheckoutSessions(customerId: string): Promise<string[]>;
  /**
   * Ids of this customer's subscriptions that have not ended (anything but canceled / incomplete_expired).
   * Stripe's own record — authoritative even before (or without) the webhook reaching Realy.
   */
  listUnendedSubscriptions(customerId: string): Promise<string[]>;
  createPortalSession(args: { customerId: string; returnUrl: string; locale: string }): Promise<{ url: string }>;
  retrieveSubscription(id: string): Promise<GatewaySubscription>;
}

export interface BillingConfig {
  gateway: PaymentGateway;
  webhookSecret: string | null;
  automaticTax: boolean;
}

let override: BillingConfig | null | undefined;

/** Test hook: inject a gateway double (or null = not configured); undefined restores env-based selection. */
export function setBillingConfigForTests(c: BillingConfig | null | undefined) {
  override = c;
}

let client: Stripe | null = null;

/** Billing configuration, or null when Stripe is NOT CONFIGURED. */
export function billingConfig(): BillingConfig | null {
  if (override !== undefined) return override;
  const e = env();
  if (!e.STRIPE_SECRET_KEY) return null;
  client ??= new Stripe(e.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "Realy" } });
  return { gateway: stripeGateway(client), webhookSecret: e.STRIPE_WEBHOOK_SECRET ?? null, automaticTax: e.STRIPE_AUTOMATIC_TAX };
}

/** Signature verification (no API key needed). Throws on an invalid or stale signature. */
export function verifyStripeWebhook(rawBody: string, signature: string, secret: string) {
  return Stripe.webhooks.constructEvent(rawBody, signature, secret);
}

const STRIPE_LOCALES = new Set(["en", "de", "zh", "hi", "ar"]);
const stripeLocale = (l: string) => {
  const lang = l.split("-")[0]!;
  return (STRIPE_LOCALES.has(lang) ? lang : "auto") as Stripe.Checkout.SessionCreateParams.Locale;
};

const toGatewaySubscription = (s: Stripe.Subscription): GatewaySubscription => ({
  id: s.id,
  customerId: typeof s.customer === "string" ? s.customer : s.customer.id,
  status: s.status,
  metadata: s.metadata ?? {},
  cancelAtPeriodEnd: s.cancel_at_period_end,
  canceledAt: s.canceled_at,
  trialEnd: s.trial_end,
  items: s.items.data.map((i) => ({
    id: i.id,
    priceId: i.price.id,
    quantity: i.quantity ?? 1,
    // Since API 2025-03-31 (basil), billing periods live on subscription items.
    currentPeriodStart: i.current_period_start ?? null,
    currentPeriodEnd: i.current_period_end ?? null,
  })),
});

export function stripeGateway(stripe: Stripe): PaymentGateway {
  return {
    async createCustomer(a, idempotencyKey) {
      const c = await stripe.customers.create(
        { name: a.name, email: a.email ?? undefined, address: { country: a.country }, metadata: { organizationId: a.organizationId } },
        { idempotencyKey },
      );
      return c.id;
    },
    async createProduct(a, idempotencyKey) {
      const p = await stripe.products.create({ name: `Realy ${a.name}`, metadata: { planKey: a.planKey } }, { idempotencyKey });
      return p.id;
    },
    async createPrice(a, idempotencyKey) {
      const p = await stripe.prices.create(
        {
          product: a.productId,
          currency: a.currency.toLowerCase(),
          unit_amount: Number(a.amountMinor), // Stripe takes integer minor units; catalog amounts are far below 2^53
          recurring: { interval: a.interval },
          tax_behavior: "unspecified",
          metadata: { priceVersionId: a.priceVersionId },
        },
        { idempotencyKey },
      );
      return p.id;
    },
    async createCoupon(a, idempotencyKey) {
      const c = await stripe.coupons.create(
        a.percentOffBps
          ? { name: a.name, percent_off: a.percentOffBps / 100, duration: "once", metadata: { promotionId: a.promotionId } }
          : { name: a.name, amount_off: Number(a.amountOffMinor), currency: a.currency!.toLowerCase(), duration: "once", metadata: { promotionId: a.promotionId } },
        { idempotencyKey },
      );
      return c.id;
    },
    async createCheckoutSession(a, idempotencyKey) {
      const s = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: a.customerId,
        client_reference_id: a.metadata.organizationId,
        line_items: [{ price: a.priceId, quantity: 1 }],
        discounts: a.couponId ? [{ coupon: a.couponId }] : undefined,
        subscription_data: { metadata: a.metadata, trial_period_days: a.trialDays > 0 ? a.trialDays : undefined },
        metadata: a.metadata,
        success_url: a.successUrl,
        cancel_url: a.cancelUrl,
        automatic_tax: { enabled: a.automaticTax },
        customer_update: a.automaticTax ? { address: "auto", name: "auto" } : undefined,
        locale: stripeLocale(a.locale),
        expires_at: Math.floor(a.expiresAt.getTime() / 1000),
      }, { idempotencyKey });
      if (!s.url) throw new Error("Stripe did not return a checkout URL");
      return { id: s.id, url: s.url };
    },
    async expireCheckoutSession(id) {
      const settled = async (): Promise<"expired" | "complete" | null> => {
        const status = (await stripe.checkout.sessions.retrieve(id)).status;
        return status === "complete" ? "complete" : status === "expired" ? "expired" : null;
      };
      const before = await settled();
      if (before) return before;
      try {
        const s = await stripe.checkout.sessions.expire(id);
        return s.status === "complete" ? "complete" : "expired";
      } catch (err) {
        // Lost a race with the customer paying (or another expiry): report the state Stripe settled on.
        const after = await settled();
        if (after) return after;
        throw err;
      }
    },
    async listOpenCheckoutSessions(customerId) {
      const ids: string[] = [];
      for await (const s of stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 100 })) ids.push(s.id);
      return ids;
    },
    async listUnendedSubscriptions(customerId) {
      const ids: string[] = [];
      for await (const sub of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
        if (sub.status !== "canceled" && sub.status !== "incomplete_expired") ids.push(sub.id);
      }
      return ids;
    },
    async createPortalSession(a) {
      const s = await stripe.billingPortal.sessions.create({ customer: a.customerId, return_url: a.returnUrl, locale: stripeLocale(a.locale) as Stripe.BillingPortal.SessionCreateParams.Locale });
      return { url: s.url };
    },
    async retrieveSubscription(id) {
      return toGatewaySubscription(await stripe.subscriptions.retrieve(id));
    },
  };
}
