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

/** Stripe accepts session lifetimes of 30 min – 24 h; computed right before the Stripe call, with margin for skew. */
const CHECKOUT_TTL_MS = 35 * 60 * 1000;
/**
 * A reservation whose Stripe session id was never recorded is treated as abandoned after this. It must exceed
 * the worst-case duration of the Stripe calls a checkout makes (each: 20 s timeout × 3 attempts); a slower
 * request that loses its reservation expires its own session instead of returning it (see below).
 */
const RESERVATION_STALE_MS = 10 * 60 * 1000;
const CHECKOUT_BUSY = "A checkout for this organization is already being started. Try again in a moment.";
const PAYMENT_IN_FLIGHT = "A payment for this organization was just completed and is being confirmed. Refresh in a moment.";

type Reservation = { kind: "reserved"; id: string } | { kind: "reuse"; url: string } | { kind: "supersede"; id: string; stripeSessionId: string };

/**
 * The database-level checkout lock: at most one OPEN `checkout_sessions` row per organization (partial
 * unique index). Concurrent requests race on that index; exactly one reserves, the rest get 409 or reuse
 * the winner's session.
 */
async function reserveCheckout(organizationId: string, priceVersionId: string, couponCode: string | null, actorId: string | null): Promise<Reservation> {
  const now = new Date();
  try {
    return await transaction(async (tx) => {
      // Stripe stops accepting payment at expiresAt; mirror that lazily so expired rows release the lock.
      await tx.checkoutSession.updateMany({ where: { organizationId, status: "OPEN", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
      if (await tx.subscription.findFirst({ where: { organizationId, status: { in: LIVE_STATUSES } }, select: { id: true } })) {
        throw conflict("This organization already has a subscription; use Manage billing to change it", { reason: "already_subscribed" });
      }
      const open = await tx.checkoutSession.findFirst({ where: { organizationId, status: "OPEN" } });
      if (open?.stripeSessionId) {
        if (open.url && open.priceVersionId === priceVersionId && open.couponCode === couponCode) return { kind: "reuse" as const, url: open.url };
        return { kind: "supersede" as const, id: open.id, stripeSessionId: open.stripeSessionId };
      }
      if (open) {
        if (now.getTime() - open.createdAt.getTime() < RESERVATION_STALE_MS) throw conflict(CHECKOUT_BUSY, { reason: "checkout_in_progress" });
        // Abandoned reservation. A Stripe session may exist for it; createCheckoutSession expires every open
        // session of the customer before creating a new one, so releasing the row here is safe.
        await tx.checkoutSession.update({ where: { id: open.id }, data: { status: "FAILED" } });
      }
      // Provisional; replaced by the session's real expiry once Stripe has created it.
      const expiresAt = new Date(now.getTime() + RESERVATION_STALE_MS + CHECKOUT_TTL_MS);
      const row = await tx.checkoutSession.create({ data: { organizationId, priceVersionId, couponCode, expiresAt, createdById: actorId } });
      return { kind: "reserved" as const, id: row.id };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict(CHECKOUT_BUSY, { reason: "checkout_in_progress" });
    throw err;
  }
}

/** Make a superseded session unpayable before another one may be created. */
async function retireSession(gateway: PaymentGateway, rowId: string | null, stripeSessionId: string) {
  const state = await gateway.expireCheckoutSession(stripeSessionId);
  if (state === "complete") {
    if (rowId) await db().checkoutSession.updateMany({ where: { id: rowId, status: "OPEN" }, data: { status: "COMPLETED", completedAt: new Date() } });
    throw conflict(PAYMENT_IN_FLIGHT, { reason: "payment_processing" });
  }
  if (rowId) await db().checkoutSession.updateMany({ where: { id: rowId, status: "OPEN" }, data: { status: "EXPIRED" } });
}

/**
 * Start Stripe Checkout for the quoted, regionally-priced plan. Everything is derived server-side from the
 * quote (the client never sends an amount). Success is only ever recorded from verified webhooks — the
 * success redirect changes nothing.
 *
 * Double-billing protection (docs/billing.md §6):
 * 1. at most one OPEN checkout per organization (database lock, see reserveCheckout);
 * 2. a different plan supersedes the open session only after Stripe confirms it can no longer be paid;
 * 3. under the lock, Stripe itself is asked whether the customer already has an unended subscription
 *    (a payment that completed but whose webhook has not been applied yet) — if so, no new session;
 * 4. before creating a session, every other open Stripe session of the customer is expired (covers
 *    sessions orphaned by a crash between Stripe and our database);
 * 5. the session id is stored only if this request still holds the reservation; otherwise the new
 *    session is expired immediately and never returned;
 * 6. at most one live subscription per organization (partial unique index; the webhook flags extras).
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
  if (existing) throw conflict("This organization already has a subscription; use Manage billing to change it", { reason: "already_subscribed" });

  const q = await quote(ctx, organizationId, { planKey: input.planKey, interval: input.interval, couponCode: input.couponCode });
  const gateway = config.gateway;

  let reservation = await reserveCheckout(organizationId, q.price.priceVersionId, q.couponCode, ctx.actor.id ?? null);
  if (reservation.kind === "supersede") {
    await retireSession(gateway, reservation.id, reservation.stripeSessionId);
    reservation = await reserveCheckout(organizationId, q.price.priceVersionId, q.couponCode, ctx.actor.id ?? null);
    if (reservation.kind === "supersede") throw conflict(CHECKOUT_BUSY, { reason: "checkout_in_progress" });
  }
  if (reservation.kind === "reuse") return { url: reservation.url };
  const { id: checkoutId } = reservation;

  try {
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

    // A completed payment whose webhook hasn't been applied (or failed to apply) is visible here first.
    if ((await gateway.listUnendedSubscriptions(customerId)).length > 0) throw conflict(PAYMENT_IN_FLIGHT, { reason: "payment_processing" });

    // Orphans (and anything created outside this flow) must be unpayable before a new session exists.
    for (const orphan of await gateway.listOpenCheckoutSessions(customerId)) {
      const row = await db().checkoutSession.findUnique({ where: { stripeSessionId: orphan }, select: { id: true } });
      await retireSession(gateway, row?.id ?? null, orphan);
    }

    const priceId = await ensureStripePrice(gateway, q.price.priceVersionId);
    let couponId: string | null = null;
    if (q.couponCode) {
      const coupon = await db().coupon.findUniqueOrThrow({ where: { code: q.couponCode } });
      couponId = await ensureStripeCoupon(gateway, coupon.promotionId);
    }

    const locale = closestLocale(input.locale);
    const base = `${env().APP_URL}/${locale}/settings/billing`;
    const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);
    const session = await gateway.createCheckoutSession(
      {
        customerId,
        priceId,
        couponId,
        trialDays: q.trialDays,
        metadata: { organizationId, priceVersionId: q.price.priceVersionId, billingCountryCode: q.billingCountryCode, checkoutId },
        successUrl: `${base}?checkout=success`,
        cancelUrl: `${base}?checkout=canceled`,
        automaticTax: config.automaticTax,
        locale,
        expiresAt,
      },
      `realy-checkout-${checkoutId}`,
    );
    const stored = await transaction(async (tx) => {
      // Only if this request still holds the reservation (a slower request may have been declared stale).
      const claimed = await tx.checkoutSession.updateMany({
        where: { id: checkoutId, status: "OPEN", stripeSessionId: null },
        data: { stripeSessionId: session.id, url: session.url, expiresAt },
      });
      if (claimed.count !== 1) return false;
      await writeAudit(tx, ctx, {
        category: "TENANT",
        organizationId,
        action: "billing.checkout_started",
        resourceType: "checkout_session",
        resourceId: checkoutId,
        newValue: { plan: q.price.plan.key, priceVersionId: q.price.priceVersionId, amountMinor: q.total.amountMinor, currency: q.total.currency, checkoutSessionId: session.id },
      });
      return true;
    });
    if (!stored) {
      // Lost the reservation: this session must never be payable.
      if ((await gateway.expireCheckoutSession(session.id)) === "complete") throw conflict(PAYMENT_IN_FLIGHT, { reason: "payment_processing" });
      throw conflict(CHECKOUT_BUSY, { reason: "checkout_in_progress" });
    }
    return { url: session.url };
  } catch (err) {
    // Release the lock. A Stripe session created before the failure is expired by the next attempt (step 3).
    await db().checkoutSession.updateMany({ where: { id: checkoutId, status: "OPEN", stripeSessionId: null }, data: { status: "FAILED" } });
    throw err;
  }
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

type Outcome = "applied" | "ignored" | "unknown_organization" | "unknown_price" | "customer_mismatch" | "duplicate_subscription";

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
  // The checkout that produced this subscription is finished, whichever event arrives first.
  if (sub.metadata.checkoutId && /^[0-9a-f-]{36}$/.test(sub.metadata.checkoutId)) {
    await tx.checkoutSession.updateMany({ where: { id: sub.metadata.checkoutId, organizationId, status: { in: ["OPEN", "EXPIRED", "FAILED"] } }, data: { status: "COMPLETED", completedAt: new Date() } });
  }
  if (LIVE_STATUSES.includes(status)) {
    // One live subscription per organization (also a partial unique index). A second one can only exist if a
    // payment slipped past the checkout lock (e.g. a session created outside Realy): never activate it
    // silently — flag it for a human to cancel/refund in Stripe, and acknowledge so Stripe stops retrying.
    const other = await tx.subscription.findFirst({ where: { organizationId, status: { in: LIVE_STATUSES }, NOT: { stripeSubscriptionId: sub.id } }, select: { id: true } });
    if (other) {
      securityEvent("billing.duplicate_subscription_blocked", { organizationId });
      logger.error({ organizationId, stripeEventId: event.id }, "second live subscription for one organization blocked; cancel/refund it in Stripe");
      await writeAudit(tx, { ...systemContext(), userAgent: "stripe-webhook" }, {
        category: "SECURITY",
        organizationId,
        action: "billing.subscription.duplicate_blocked",
        resourceType: "subscription",
        resourceId: other.id,
        newValue: { stripeSubscriptionId: sub.id, stripeStatus: sub.status, stripeEventId: event.id },
      });
      return { outcome: "duplicate_subscription", organizationId };
    }
  }
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
  "checkout.session.expired",
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
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.expired") {
        const sessionId = String((event.data.object as { id?: unknown }).id ?? "");
        const done = event.type === "checkout.session.completed";
        // Never moves a COMPLETED row back; payment state itself comes only from the subscription below.
        await tx.checkoutSession.updateMany({
          where: { stripeSessionId: sessionId, status: done ? { in: ["OPEN", "EXPIRED", "FAILED"] } : "OPEN" },
          data: done ? { status: "COMPLETED", completedAt: new Date() } : { status: "EXPIRED" },
        });
      }
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
