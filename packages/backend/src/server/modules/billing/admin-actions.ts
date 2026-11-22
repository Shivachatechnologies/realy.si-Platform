/**
 * Control Center billing actions (stream D): subscription changes, refunds and the Stripe mirror backfill.
 *
 * Every action is a real Stripe API call behind a platform permission (MFA-gated), a reason and an audit entry;
 * destructive ones also take a typed confirmation. Local subscription state still changes only when Stripe's verified
 * webhook arrives — nothing is applied optimistically and no payment is ever simulated.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { env } from "@/server/core/env";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { reasonSchema, requirePlatform, requireConfirmation } from "@/server/modules/admin/access";
import { invalidateEntitlements } from "@/server/modules/entitlements/service";
import { billingConfig, type StripeSyncKind } from "./gateway";
import { BILLING_NOT_CONFIGURED, changeSubscriptionPlan, ensureStripeCoupon, requireGatewayMethod, setSubscriptionCancellation } from "./stripe-billing";
import { syncFetchedObject, upsertRefund } from "./stripe-sync";

const MANAGE = "platform.subscriptions.manage";
const REFUND = "platform.billing.refund";

function gateway() {
  const c = billingConfig();
  if (!c) throw new AppError("not_configured", BILLING_NOT_CONFIGURED);
  return c.gateway;
}

const digest = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);

async function subscriptionFor(subscriptionId: string) {
  const sub = await db().subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true, organization: { select: { id: true, name: true, slug: true } } } });
  if (!sub) throw notFound("Subscription");
  if (!sub.stripeSubscriptionId) throw new AppError("not_available", "This subscription is not billed through Stripe", { reason: "billing_no_stripe_subscription" });
  return sub;
}

const adminAudit = (ctx: RequestContext, sub: { id: string; organizationId: string }, action: string, oldValue: unknown, newValue: unknown, reason: string) =>
  transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", organizationId: sub.organizationId, action, resourceType: "subscription", resourceId: sub.id, oldValue, newValue, reason }));

// ───────────── Subscription actions ─────────────

export const subscriptionPlanInput = z.object({ planKey: z.string().min(1).max(41), interval: z.enum(["MONTH", "YEAR"]), reason: reasonSchema });

/** Upgrade / downgrade (Stripe prorates). Applied locally by the webhook. */
export async function adminSubscriptionChangePlan(ctx: RequestContext, subscriptionId: string, raw: z.input<typeof subscriptionPlanInput>) {
  const input = subscriptionPlanInput.parse(raw);
  await requirePlatform(ctx, MANAGE);
  const sub = await subscriptionFor(subscriptionId);
  const live = await db().subscription.findFirst({ where: { organizationId: sub.organizationId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] }, stripeSubscriptionId: { not: null } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (live?.id !== sub.id) throw conflict("Only the organization's live subscription can change plan", { reason: "billing_not_live" });
  return changeSubscriptionPlan(ctx, sub.organizationId, { planKey: input.planKey, interval: input.interval }, { asPlatform: true, reason: input.reason });
}

export const subscriptionCancelInput = z.object({ mode: z.enum(["period_end", "resume", "immediately"]), reason: reasonSchema, confirm: z.string().max(200).optional() });

/**
 * Cancel at period end, resume (undo a scheduled cancel), or cancel immediately. Immediate cancellation ends access
 * now and is destructive: it needs the organization's slug typed as confirmation.
 */
export async function adminSubscriptionCancel(ctx: RequestContext, subscriptionId: string, raw: z.input<typeof subscriptionCancelInput>) {
  const input = subscriptionCancelInput.parse(raw);
  await requirePlatform(ctx, MANAGE);
  const sub = await subscriptionFor(subscriptionId);
  if (sub.status === "CANCELED" || sub.status === "INCOMPLETE_EXPIRED") throw conflict("This subscription has already ended", { reason: "billing_subscription_ended" });
  if (input.mode !== "immediately") return setSubscriptionCancellation(ctx, sub.organizationId, input.mode === "period_end", { asPlatform: true, reason: input.reason });
  requireConfirmation(input.confirm, sub.organization.slug);
  const cancelNow = requireGatewayMethod(gateway(), "cancelSubscriptionNow");
  await cancelNow(sub.stripeSubscriptionId!, `realy-admin-cancel-${sub.id}`);
  await adminAudit(ctx, sub, "billing.subscription.cancel_now_requested", { status: sub.status }, { status: "CANCELED" }, input.reason);
  return { ok: true, pending: true };
}

export const subscriptionPauseInput = z.object({ behavior: z.enum(["keep_as_draft", "mark_uncollectible", "void"]).nullable(), reason: reasonSchema });

/** Pause collection (Stripe `pause_collection`) or resume it (behavior null). Access is unchanged; invoices are held. */
export async function adminSubscriptionPause(ctx: RequestContext, subscriptionId: string, raw: z.input<typeof subscriptionPauseInput>) {
  const input = subscriptionPauseInput.parse(raw);
  await requirePlatform(ctx, MANAGE);
  const sub = await subscriptionFor(subscriptionId);
  if (!["ACTIVE", "PAST_DUE", "TRIALING", "PAUSED"].includes(sub.status)) throw conflict("Only a live subscription can be paused or resumed", { reason: "billing_not_live" });
  const pause = requireGatewayMethod(gateway(), "setPauseCollection");
  await pause(sub.stripeSubscriptionId!, input.behavior, `realy-admin-pause-${sub.id}-${digest(input.behavior, ctx.requestId)}`);
  await adminAudit(ctx, sub, input.behavior ? "billing.subscription.pause_requested" : "billing.subscription.unpause_requested", null, { pauseCollection: input.behavior }, input.reason);
  return { ok: true, pending: true };
}

const MAX_TRIAL_DAYS_AHEAD = 730; // Stripe's limit for trial_end

export const subscriptionTrialInput = z.object({ trialEndsAt: z.coerce.date(), reason: reasonSchema });

/** Move a trial's end later (no proration). Only for TRIALING subscriptions; never shortens a trial. */
export async function adminSubscriptionExtendTrial(ctx: RequestContext, subscriptionId: string, raw: z.input<typeof subscriptionTrialInput>) {
  const input = subscriptionTrialInput.parse(raw);
  await requirePlatform(ctx, MANAGE);
  const sub = await subscriptionFor(subscriptionId);
  if (sub.status !== "TRIALING") throw conflict("Only a trialing subscription can have its trial extended", { reason: "billing_not_trialing" });
  const floor = Math.max(Date.now(), sub.trialEndsAt?.getTime() ?? 0);
  if (input.trialEndsAt.getTime() <= floor) throw invalid("The new trial end must be later than the current one", { field: "trialEndsAt" });
  if (input.trialEndsAt.getTime() > Date.now() + MAX_TRIAL_DAYS_AHEAD * 86_400_000) throw invalid("Stripe allows trials of at most two years", { field: "trialEndsAt" });
  const setTrial = requireGatewayMethod(gateway(), "setTrialEnd");
  const end = Math.floor(input.trialEndsAt.getTime() / 1000);
  await setTrial(sub.stripeSubscriptionId!, end, `realy-admin-trial-${sub.id}-${end}`);
  await adminAudit(ctx, sub, "billing.subscription.trial_extend_requested", { trialEndsAt: sub.trialEndsAt }, { trialEndsAt: input.trialEndsAt }, input.reason);
  return { ok: true, pending: true };
}

export const subscriptionCouponInput = z.object({ couponCode: z.string().trim().min(1).max(64), reason: reasonSchema });

/** Apply an existing, active promotion's coupon to the subscription's future invoices. */
export async function adminSubscriptionApplyCoupon(ctx: RequestContext, subscriptionId: string, raw: z.input<typeof subscriptionCouponInput>) {
  const input = subscriptionCouponInput.parse(raw);
  await requirePlatform(ctx, MANAGE);
  const sub = await subscriptionFor(subscriptionId);
  if (!["ACTIVE", "PAST_DUE", "TRIALING"].includes(sub.status)) throw conflict("Only a live subscription can take a coupon", { reason: "billing_not_live" });
  const coupon = await db().coupon.findUnique({ where: { code: input.couponCode }, include: { promotion: true } });
  const now = new Date();
  const p = coupon?.promotion;
  if (!coupon || !p || p.status !== "ACTIVE" || p.startsAt > now || (p.endsAt && p.endsAt <= now)) throw invalid("Unknown or inactive coupon", { field: "couponCode" });
  if (p.maxRedemptions !== null && coupon.redemptions >= p.maxRedemptions) throw invalid("This coupon has no redemptions left", { field: "couponCode" });
  if (p.planKeys.length && !p.planKeys.includes(sub.plan.key)) throw invalid("This coupon does not apply to the subscription's plan", { field: "couponCode" });
  if (p.discountType !== "PERCENT" && p.currency && p.currency !== sub.currency) throw invalid("The coupon's currency differs from the subscription's", { field: "couponCode" });
  const g = gateway();
  const apply = requireGatewayMethod(g, "applySubscriptionCoupon");
  const stripeCoupon = await ensureStripeCoupon(g, p.id);
  await apply(sub.stripeSubscriptionId!, stripeCoupon, `realy-admin-coupon-${sub.id}-${coupon.id}`);
  await transaction(async (tx) => {
    await tx.coupon.update({ where: { id: coupon.id }, data: { redemptions: { increment: 1 } } });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: sub.organizationId, action: "billing.subscription.coupon_applied", resourceType: "subscription", resourceId: sub.id, newValue: { couponCode: coupon.code, promotionId: p.id }, reason: input.reason });
  });
  return { ok: true, pending: true };
}

// ───────────── Refunds ─────────────

export const refundInput = z.object({
  paymentId: z.string().uuid(),
  /** Minor units; must not exceed what is still refundable. */
  amountMinor: z.union([z.string().regex(/^\d{1,15}$/), z.number().int().positive()]).transform((v) => BigInt(v)),
  stripeReason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).nullable().default(null),
  reason: reasonSchema,
  /** Typed confirmation: the payment's Stripe charge id. */
  confirm: z.string().max(200).optional(),
});

/** What can still be refunded on a payment: captured amount minus succeeded and pending refunds. */
export async function refundableMinor(paymentId: string) {
  const p = await db().platformPayment.findUnique({ where: { id: paymentId } });
  if (!p) throw notFound("Payment");
  const pending = await db().platformRefund.aggregate({ where: { paymentId, status: { in: ["pending", "requires_action", "succeeded"] } }, _sum: { amountMinor: true } });
  const refunded = (pending._sum.amountMinor ?? 0n) > p.refundedMinor ? (pending._sum.amountMinor ?? 0n) : p.refundedMinor;
  return { payment: p, refundable: p.amountMinor - refunded > 0n ? p.amountMinor - refunded : 0n };
}

/**
 * Issue a real Stripe refund (full or partial) for a synced payment. Needs platform.billing.refund (MFA), a reason and
 * the charge id typed as confirmation. The refund row is recorded from Stripe's response; later status changes arrive
 * through `refund.updated`. The Stripe idempotency key is derived from the payment's refund state, so a double submit
 * cannot refund twice.
 */
export async function issueRefund(ctx: RequestContext, raw: z.input<typeof refundInput>) {
  const input = refundInput.parse(raw);
  await requirePlatform(ctx, REFUND);
  const { payment, refundable } = await refundableMinor(input.paymentId);
  if (!payment.stripeChargeId) throw new AppError("not_available", "This payment has no Stripe charge to refund", { reason: "billing_no_charge" });
  if (!["succeeded", "partially_refunded", "disputed"].includes(payment.status)) throw conflict("Only a succeeded payment can be refunded", { reason: "billing_not_refundable" });
  if (payment.status === "disputed") throw conflict("This payment is disputed; respond to the dispute in Stripe instead of refunding", { reason: "billing_disputed" });
  if (input.amountMinor > refundable) throw invalid("The amount exceeds what is still refundable", { field: "amountMinor", refundableMinor: refundable.toString() });
  requireConfirmation(input.confirm, payment.stripeChargeId);
  const create = requireGatewayMethod(gateway(), "createRefund");
  let rawRefund: Record<string, unknown>;
  try {
    rawRefund = await create(
      { chargeId: payment.stripeChargeId, amountMinor: input.amountMinor, reason: input.stripeReason, metadata: { realyAdminId: ctx.actor.id ?? "", realyPaymentId: payment.id } },
      `realy-refund-${payment.id}-${payment.refundedMinor}-${refundable}-${input.amountMinor}`,
    );
  } catch (err) {
    logger.warn({ paymentId: payment.id, err: err instanceof Error ? err.message : String(err) }, "stripe refund failed");
    await transaction((tx) =>
      writeAudit(tx, ctx, { category: "ADMIN", organizationId: payment.organizationId, action: "billing.refund.failed", resourceType: "payment", resourceId: payment.id, newValue: { amountMinor: input.amountMinor, currency: payment.currency, error: err instanceof Error ? err.message.slice(0, 300) : "Stripe request failed" }, reason: input.reason }),
    );
    throw new AppError("service_unavailable", err instanceof Error ? err.message.slice(0, 300) : "Stripe refused the refund", { reason: "billing_refund_failed" });
  }
  const row = await transaction(async (tx) => {
    const r = await upsertRefund(tx, rawRefund, new Date(), payment.livemode, { createdById: ctx.actor.id ?? null });
    await writeAudit(tx, ctx, {
      category: "ADMIN",
      organizationId: payment.organizationId,
      action: "billing.refund.issued",
      resourceType: "payment",
      resourceId: payment.id,
      oldValue: { refundedMinor: payment.refundedMinor, status: payment.status },
      newValue: { amountMinor: input.amountMinor, currency: payment.currency, stripeRefundId: String(rawRefund.id ?? ""), stripeReason: input.stripeReason, livemode: payment.livemode },
      reason: input.reason,
    });
    return r;
  });
  if (payment.organizationId) invalidateEntitlements(payment.organizationId);
  return { ok: true, refundId: row.id, stripeRefundId: String(rawRefund.id ?? ""), status: String(rawRefund.status ?? "pending") };
}

// ───────────── Backfill ─────────────

export const backfillInput = z.object({
  kind: z.enum(["invoices", "charges", "refunds", "disputes"]),
  sinceDays: z.number().int().min(1).max(730).default(90),
  startingAfter: z.string().regex(/^[a-z]{2,6}_[A-Za-z0-9_]+$/).max(255).optional(),
  reason: reasonSchema,
});

const PAGE = 100;
const PAGES_PER_CALL = 3;

/**
 * Copy existing Stripe objects into the mirror tables (read-only towards Stripe; idempotent upserts). One call
 * processes at most 300 objects of one kind, newest first, and returns the cursor to continue with.
 */
export async function backfillStripe(ctx: RequestContext, raw: z.input<typeof backfillInput>) {
  const input = backfillInput.parse(raw);
  await requirePlatform(ctx, MANAGE);
  const list = requireGatewayMethod(gateway(), "listStripeObjects");
  const key = env().STRIPE_SECRET_KEY ?? "";
  const livemode = key.startsWith("sk_live") || key.startsWith("rk_live");
  const createdGte = Math.floor((Date.now() - input.sinceDays * 86_400_000) / 1000);
  let cursor = input.startingAfter;
  let processed = 0;
  let applied = 0;
  let hasMore = false;
  for (let i = 0; i < PAGES_PER_CALL; i++) {
    const page = await list(input.kind as StripeSyncKind, { limit: PAGE, createdGte, ...(cursor ? { startingAfter: cursor } : {}) });
    const at = new Date();
    for (const o of page.data) {
      const r = await transaction((tx) => syncFetchedObject(tx, input.kind, o, at, livemode));
      processed++;
      if (r.applied) applied++;
    }
    hasMore = page.hasMore;
    const last = page.data[page.data.length - 1];
    cursor = last && typeof last.id === "string" ? last.id : cursor;
    if (!hasMore || page.data.length === 0) break;
  }
  await transaction((tx) =>
    writeAudit(tx, ctx, { category: "ADMIN", action: "billing.stripe_backfill", resourceType: "stripe_sync", resourceId: input.kind, newValue: { kind: input.kind, sinceDays: input.sinceDays, processed, applied, hasMore }, reason: input.reason }),
  );
  return { kind: input.kind, processed, applied, hasMore, nextCursor: hasMore ? (cursor ?? null) : null };
}
