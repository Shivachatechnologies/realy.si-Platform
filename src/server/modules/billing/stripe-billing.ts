import { z } from "zod";
import type { SubscriptionStatus } from "@/generated/prisma/enums";
import { db, transaction, Prisma, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { systemContext } from "@/server/core/context";
import { AppError, conflict, invalid } from "@/server/core/errors";
import { env } from "@/server/core/env";
import { logger } from "@/server/core/logger";
import { securityEvent } from "@/server/core/telemetry";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { closestLocale } from "@/i18n/config";
import { billingConfig, verifyStripeWebhook, type GatewaySubscription, type PaymentGateway } from "./gateway";
import { quote, quoteInput } from "./service";

export const BILLING_NOT_CONFIGURED = "Billing is not configured.";

export const billingConfigured = () => billingConfig() !== null;

function requireGateway(): PaymentGateway {
  const c = billingConfig();
  if (!c) throw new AppError("not_configured", BILLING_NOT_CONFIGURED);
  return c.gateway;
}

const LIVE_STATUSES: SubscriptionStatus[] = ["ACTIVE", "TRIALING", "PAST_DUE", "INCOMPLETE", "UNPAID", "PAUSED"];

/** Lazily mirror catalog objects into Stripe. Idempotency keys make concurrent first-use safe. */
async function ensureStripePrice(gateway: PaymentGateway, priceVersionId: string): Promise<string> {
  const version = await db().priceVersion.findUniqueOrThrow({ where: { id: priceVersionId }, include: { price: { include: { plan: true } } } });
  if (version.stripePriceId) return version.stripePriceId;
  const plan = version.price.plan;
  let productId = plan.stripeProductId;
  if (!productId) {
    productId = await gateway.createProduct({ planKey: plan.key, name: plan.name }, `realy-product-${plan.id}`);
    await db().plan.updateMany({ where: { id: plan.id, stripeProductId: null }, data: { stripeProductId: productId } });
    productId = (await db().plan.findUniqueOrThrow({ where: { id: plan.id } })).stripeProductId!;
  }
  const priceId = await gateway.createPrice(
    {
      productId,
      amountMinor: version.amountMinor,
      currency: version.currency,
      interval: version.price.interval === "YEAR" ? "year" : "month",
      priceVersionId: version.id,
    },
    `realy-price-${version.id}`,
  );
  // stripe_price_id is the one mutable column on an otherwise immutable version (see migration trigger).
  await db().priceVersion.updateMany({ where: { id: version.id, stripePriceId: null }, data: { stripePriceId: priceId } });
  return (await db().priceVersion.findUniqueOrThrow({ where: { id: version.id } })).stripePriceId!;
}

async function ensureStripeCoupon(gateway: PaymentGateway, promotionId: string): Promise<string> {
  const p = await db().promotion.findUniqueOrThrow({ where: { id: promotionId } });
  if (p.stripeCouponId) return p.stripeCouponId;
  const id = await gateway.createCoupon(
    { promotionId: p.id, name: p.name, percentOffBps: p.percentOffBps ?? undefined, amountOffMinor: p.amountOffMinor ?? undefined, currency: p.currency ?? undefined },
    `realy-coupon-${p.id}`,
  );
  await db().promotion.updateMany({ where: { id: p.id, stripeCouponId: null }, data: { stripeCouponId: id } });
  return (await db().promotion.findUniqueOrThrow({ where: { id: p.id } })).stripeCouponId!;
}

export const checkoutInput = quoteInput.extend({ locale: z.string().max(35).optional() });

/**
 * Start Stripe Checkout for the quoted, regionally-priced plan. Everything is derived server-side from the
 * quote (the client never sends an amount). Success is only ever recorded from verified webhooks.
 */
export async function createCheckoutSession(ctx: RequestContext, organizationId: string, raw: z.input<typeof checkoutInput>) {
  const input = checkoutInput.parse(raw);
  await requirePermission(ctx, "billing.manage", orgChain(organizationId));
  const config = billingConfig();
  if (!config) throw new AppError("not_configured", BILLING_NOT_CONFIGURED);

  const profile = await db().billingProfile.findUnique({ where: { organizationId } });
  if (!profile?.billingCountryConfirmedAt) throw invalid("Confirm your billing country before checkout", { field: "billingCountryCode" });
  if (input.billingCountryCode && input.billingCountryCode !== profile.billingCountryCode) {
    throw invalid("Checkout uses the confirmed billing country; update it first", { field: "billingCountryCode" });
  }
  const existing = await db().subscription.findFirst({ where: { organizationId, status: { in: LIVE_STATUSES } } });
  if (existing) throw conflict("This organization already has a subscription; use Manage billing to change it");

  const q = await quote(ctx, organizationId, { planKey: input.planKey, interval: input.interval, couponCode: input.couponCode });
  const gateway = config.gateway;
  const org = await db().organization.findUniqueOrThrow({ where: { id: organizationId } });
  const owner = ctx.actor.id ? await db().user.findUnique({ where: { id: ctx.actor.id }, select: { email: true } }) : null;

  let customerId = profile.stripeCustomerId;
  if (!customerId) {
    customerId = await gateway.createCustomer(
      { organizationId, name: profile.legalName ?? org.name, email: owner?.email ?? null, country: profile.billingCountryCode },
      `realy-customer-${organizationId}`,
    );
    await db().billingProfile.updateMany({ where: { organizationId, stripeCustomerId: null }, data: { stripeCustomerId: customerId } });
    customerId = (await db().billingProfile.findUniqueOrThrow({ where: { organizationId } })).stripeCustomerId!;
  }

  const priceId = await ensureStripePrice(gateway, q.price.priceVersionId);
  let couponId: string | null = null;
  if (q.couponCode) {
    const coupon = await db().coupon.findUniqueOrThrow({ where: { code: q.couponCode } });
    couponId = await ensureStripeCoupon(gateway, coupon.promotionId);
  }

  const locale = closestLocale(input.locale);
  const base = `${env().APP_URL}/${locale}/settings/billing`;
  const session = await gateway.createCheckoutSession({
    customerId,
    priceId,
    couponId,
    trialDays: q.trialDays,
    metadata: { organizationId, priceVersionId: q.price.priceVersionId, billingCountryCode: q.billingCountryCode },
    successUrl: `${base}?checkout=success`,
    cancelUrl: `${base}?checkout=canceled`,
    automaticTax: config.automaticTax,
    locale,
  });
  await transaction((tx) =>
    writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "billing.checkout_started",
      resourceType: "billing_profile",
      resourceId: profile.id,
      newValue: { plan: q.price.plan.key, priceVersionId: q.price.priceVersionId, amountMinor: q.total.amountMinor, currency: q.total.currency, checkoutSessionId: session.id },
    }),
  );
  return { url: session.url };
}

/** Stripe customer portal (payment methods, invoices, cancellation) for an existing billing customer. */
export async function createPortalSession(ctx: RequestContext, organizationId: string, localeRaw?: string) {
  await requirePermission(ctx, "billing.manage", orgChain(organizationId));
  const gateway = requireGateway();
  const profile = await db().billingProfile.findUnique({ where: { organizationId } });
  if (!profile?.stripeCustomerId) throw new AppError("not_available", "No billing account exists yet for this organization");
  const locale = closestLocale(localeRaw);
  return gateway.createPortalSession({ customerId: profile.stripeCustomerId, returnUrl: `${env().APP_URL}/${locale}/settings/billing`, locale });
}

// ───────────── Webhooks ─────────────

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: "ACTIVE",
  trialing: "TRIALING",
  past_due: "PAST_DUE",
  canceled: "CANCELED",
  unpaid: "UNPAID",
  incomplete: "INCOMPLETE",
  incomplete_expired: "INCOMPLETE_EXPIRED",
  paused: "PAUSED",
};

const ts = (s: number | null | undefined) => (s ? new Date(s * 1000) : null);

interface MinimalEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

/** Subscription id referenced by an event's object (subscription, checkout session or invoice; old and new API shapes). */
function subscriptionIdOf(event: MinimalEvent): string | null {
  const o = event.data.object as Record<string, unknown>;
  const ref = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String((v as { id: unknown }).id) : null);
  if (event.type.startsWith("customer.subscription.")) return ref(o.id);
  if (event.type === "checkout.session.completed") return o.mode === "subscription" ? ref(o.subscription) : null;
  if (event.type.startsWith("invoice.")) {
    const parent = o.parent as { subscription_details?: { subscription?: unknown } } | undefined;
    return ref(parent?.subscription_details?.subscription) ?? ref(o.subscription);
  }
  return null;
}

type Outcome = "applied" | "ignored" | "unknown_organization" | "unknown_price" | "customer_mismatch";

/**
 * Apply the *current* Stripe subscription state (re-fetched, so out-of-order events are harmless).
 * The subscription item stays locked to the price version it was sold at; it only changes when the
 * customer switched to another Stripe price that maps to a different catalog version.
 */
async function applySubscription(tx: Tx, sub: GatewaySubscription, event: MinimalEvent): Promise<{ outcome: Outcome; organizationId: string | null }> {
  const organizationId = sub.metadata.organizationId ?? null;
  if (!organizationId || !/^[0-9a-f-]{36}$/.test(organizationId)) return { outcome: "unknown_organization", organizationId: null };
  const profile = await tx.billingProfile.findUnique({ where: { organizationId } });
  if (!profile) return { outcome: "unknown_organization", organizationId: null };
  if (profile.stripeCustomerId !== sub.customerId) {
    securityEvent("billing.webhook_customer_mismatch", { organizationId });
    return { outcome: "customer_mismatch", organizationId };
  }
  const item = sub.items[0];
  if (!item) return { outcome: "ignored", organizationId };
  const version = await tx.priceVersion.findUnique({ where: { stripePriceId: item.priceId }, include: { price: true } });
  if (!version) return { outcome: "unknown_price", organizationId };

  const status = STATUS_MAP[sub.status] ?? "INCOMPLETE";
  const data = {
    status,
    planId: version.price.planId,
    currency: version.currency,
    interval: version.price.interval,
    currentPeriodStart: ts(item.currentPeriodStart),
    currentPeriodEnd: ts(item.currentPeriodEnd),
    trialEndsAt: ts(sub.trialEnd),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    canceledAt: ts(sub.canceledAt),
  };
  const ctx = { ...systemContext(), userAgent: "stripe-webhook" };
  const existing = await tx.subscription.findUnique({ where: { stripeSubscriptionId: sub.id }, include: { items: true } });
  if (existing && existing.organizationId !== organizationId) {
    // A Stripe subscription never moves between tenants; treat a metadata change as hostile/misconfigured.
    securityEvent("billing.webhook_tenant_mismatch", { organizationId });
    return { outcome: "customer_mismatch", organizationId };
  }
  if (!existing) {
    const created = await tx.subscription.create({
      data: {
        ...data,
        organizationId,
        billingCountryCode: sub.metadata.billingCountryCode ?? profile.billingCountryCode,
        stripeSubscriptionId: sub.id,
        items: {
          create: {
            priceVersionId: version.id,
            quantity: item.quantity,
            unitAmountMinor: version.amountMinor,
            currency: version.currency,
            stripeSubscriptionItemId: item.id,
          },
        },
      },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "billing.subscription.created",
      resourceType: "subscription",
      resourceId: created.id,
      newValue: { status, priceVersionId: version.id, amountMinor: version.amountMinor, currency: version.currency, stripeEventId: event.id },
    });
    return { outcome: "applied", organizationId };
  }

  await tx.subscription.update({ where: { id: existing.id }, data });
  const current = existing.items[0];
  if (current && current.priceVersionId !== version.id) {
    await tx.subscriptionItem.update({
      where: { id: current.id },
      data: { priceVersionId: version.id, unitAmountMinor: version.amountMinor, currency: version.currency, quantity: item.quantity, stripeSubscriptionItemId: item.id },
    });
  }
  if (existing.status !== status || current?.priceVersionId !== version.id || existing.cancelAtPeriodEnd !== sub.cancelAtPeriodEnd) {
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "billing.subscription.updated",
      resourceType: "subscription",
      resourceId: existing.id,
      oldValue: { status: existing.status, priceVersionId: current?.priceVersionId, cancelAtPeriodEnd: existing.cancelAtPeriodEnd },
      newValue: { status, priceVersionId: version.id, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, stripeEventId: event.id },
    });
  }
  return { outcome: "applied", organizationId };
}

const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);

/**
 * Verify and process one Stripe webhook delivery. Idempotent: the event id is recorded in the same
 * transaction as its effects, so retries and duplicate deliveries are no-ops. Processing errors return
 * a 5xx (rolled back, nothing recorded) so Stripe retries.
 */
export async function handleStripeWebhook(rawBody: string, signature: string | null): Promise<{ status: number; body: Record<string, unknown> }> {
  const config = billingConfig();
  if (!config?.webhookSecret) return { status: 501, body: { error: { code: "not_configured", message: BILLING_NOT_CONFIGURED } } };
  if (!signature) return { status: 400, body: { error: { code: "validation_error", message: "Missing Stripe-Signature" } } };

  let event: MinimalEvent;
  try {
    event = verifyStripeWebhook(rawBody, signature, config.webhookSecret) as unknown as MinimalEvent;
  } catch {
    securityEvent("billing.webhook_signature_invalid", {});
    return { status: 400, body: { error: { code: "validation_error", message: "Invalid signature" } } };
  }

  if (await db().stripeEvent.findUnique({ where: { id: event.id } })) return { status: 200, body: { received: true, duplicate: true } };

  // Fetch remote state before opening the DB transaction (no network calls while holding locks).
  let sub: GatewaySubscription | null = null;
  const subscriptionId = HANDLED.has(event.type) ? subscriptionIdOf(event) : null;
  if (subscriptionId) sub = await config.gateway.retrieveSubscription(subscriptionId);

  try {
    const outcome = await transaction(async (tx) => {
      await tx.stripeEvent.create({ data: { id: event.id, type: event.type, livemode: event.livemode, outcome: "processing" } });
      let result: { outcome: Outcome; organizationId: string | null } = { outcome: "ignored", organizationId: null };
      if (sub) result = await applySubscription(tx, sub, event);
      if (sub && result.outcome === "applied" && event.type.startsWith("invoice.")) {
        const field = event.type === "invoice.payment_failed" ? "lastPaymentFailedAt" : "lastPaymentSucceededAt";
        await tx.subscription.update({ where: { stripeSubscriptionId: sub.id }, data: { [field]: new Date() } });
      }
      await tx.stripeEvent.update({ where: { id: event.id }, data: { outcome: result.outcome, organizationId: result.organizationId } });
      return result.outcome;
    });
    if (outcome !== "applied" && outcome !== "ignored") logger.warn({ eventId: event.id, type: event.type, outcome }, "stripe webhook not applied");
    return { status: 200, body: { received: true, outcome } };
  } catch (err) {
    // Only a concurrent delivery of the *same event* counts as a duplicate. Any other failure (including
    // unrelated unique violations) must surface as 5xx so Stripe retries — never acknowledge lost work.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && (await db().stripeEvent.findUnique({ where: { id: event.id } }))) {
      return { status: 200, body: { received: true, duplicate: true } };
    }
    logger.error({ eventId: event.id, type: event.type, err: (err as Error).message }, "stripe webhook processing failed");
    throw err;
  }
}
