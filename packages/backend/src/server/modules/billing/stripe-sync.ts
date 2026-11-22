/**
 * Stripe → platform_* mirror (Control Center billing, docs/admin/STREAMS.md stream D).
 *
 * Invoices, charges (payments), refunds and disputes are upserted from verified webhook payloads (inside the same
 * transaction that records the `stripe_events` row, so a replay is a no-op) and from the admin backfill (Stripe list
 * APIs). Nothing here moves money or invents a payment: every row is a copy of an object Stripe reported.
 *
 * Ordering: each row remembers the `created` time of the newest event applied to it (`stripeUpdatedAt`; a backfill
 * uses its fetch time). An older event that arrives later is ignored, so out-of-order deliveries cannot roll a row
 * back. Ties (same second) never move an invoice out of a final state (paid / void / uncollectible).
 *
 * Payload shapes: both the current API (invoice.parent.subscription_details, invoice.total_taxes, invoice_payment
 * objects) and older endpoint versions (invoice.subscription / invoice.tax / charge.invoice) are understood, because
 * webhook payloads follow the endpoint's API version, not the SDK's.
 */
import type { Tx } from "@/server/core/db";

export type Raw = Record<string, unknown>;

/** Event types whose objects are mirrored (in addition to the subscription events handled by stripe-billing.ts). */
export const SYNC_EVENT_TYPES = new Set([
  "invoice.created",
  "invoice.finalized",
  "invoice.updated",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "invoice_payment.paid",
  "charge.succeeded",
  "charge.failed",
  "charge.pending",
  "charge.captured",
  "charge.updated",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.refund.updated",
]);

// ───────────── Field helpers (tolerant of expanded objects and missing fields) ─────────────

export const ref = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" && "id" in v && typeof (v as { id: unknown }).id === "string" ? (v as { id: string }).id : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const int = (v: unknown): bigint => (typeof v === "number" && Number.isFinite(v) ? BigInt(Math.trunc(v)) : 0n);
const tsOf = (v: unknown): Date | null => (typeof v === "number" && v > 0 ? new Date(v * 1000) : null);
const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);
const cur = (v: unknown) => (typeof v === "string" && v.length === 3 ? v.toUpperCase() : "USD");
const sumAmounts = (v: unknown) => (Array.isArray(v) ? v.reduce<bigint>((a, x) => a + int(obj(x)?.amount), 0n) : 0n);

const FINAL_INVOICE = new Set(["paid", "void", "uncollectible"]);

// ───────────── Normalizers (pure; unit-tested) ─────────────

export function normalizeInvoice(o: Raw) {
  const parent = obj(o.parent);
  const subDetails = obj(parent?.subscription_details);
  const transitions = obj(o.status_transitions);
  const autoTax = obj(o.automatic_tax);
  const totalTaxes = o.total_taxes;
  const taxKnown = (Array.isArray(totalTaxes) && totalTaxes.length > 0) || autoTax?.enabled === true || (typeof o.tax === "number" && o.tax > 0);
  const taxMinor = Array.isArray(totalTaxes) ? sumAmounts(totalTaxes) : int(o.tax);
  // Old API versions: invoice.payment_intent / invoice.charge; new: payments are linked by invoice_payment.paid.
  return {
    stripeInvoiceId: String(o.id),
    stripeCustomerId: ref(o.customer),
    stripeSubscriptionId: ref(subDetails?.subscription) ?? ref(o.subscription),
    number: str(o.number),
    status: str(o.status) ?? "draft",
    billingReason: str(o.billing_reason),
    currency: cur(o.currency),
    subtotalMinor: int(o.subtotal),
    discountMinor: sumAmounts(o.total_discount_amounts),
    taxMinor,
    taxKnown,
    totalMinor: int(o.total),
    amountPaidMinor: int(o.amount_paid),
    amountDueMinor: int(o.amount_due),
    amountRemainingMinor: typeof o.amount_remaining === "number" ? int(o.amount_remaining) : int(o.amount_due) - int(o.amount_paid),
    attemptCount: typeof o.attempt_count === "number" ? o.attempt_count : 0,
    periodStart: tsOf(o.period_start),
    periodEnd: tsOf(o.period_end),
    dueAt: tsOf(o.due_date),
    paidAt: tsOf(transitions?.paid_at),
    voidedAt: tsOf(transitions?.voided_at),
    hostedUrl: str(o.hosted_invoice_url),
    pdfUrl: str(o.invoice_pdf),
    livemode: o.livemode === true,
    createdAt: tsOf(o.created) ?? new Date(),
    legacyPaymentIntentId: ref(o.payment_intent),
    legacyChargeId: ref(o.charge),
  };
}

export function paymentStatusOf(o: { status: string | null; amountMinor: bigint; refundedMinor: bigint; disputed: boolean }) {
  if (o.disputed) return "disputed";
  if (o.status === "succeeded" && o.refundedMinor > 0n) return o.refundedMinor >= o.amountMinor ? "refunded" : "partially_refunded";
  return o.status === "succeeded" || o.status === "failed" ? o.status : "pending";
}

export function normalizeCharge(o: Raw) {
  const pm = obj(o.payment_method_details);
  const type = str(pm?.type);
  const card = type ? obj(pm?.[type]) : null;
  const amountMinor = int(o.amount);
  const refundedMinor = int(o.amount_refunded);
  const disputed = o.disputed === true;
  return {
    stripeChargeId: String(o.id),
    stripePaymentIntentId: ref(o.payment_intent),
    stripeCustomerId: ref(o.customer),
    stripeInvoiceId: ref(o.invoice),
    status: paymentStatusOf({ status: str(o.status), amountMinor, refundedMinor, disputed }),
    amountMinor,
    refundedMinor,
    currency: cur(o.currency),
    failureCode: str(o.failure_code),
    failureMessage: str(o.failure_message)?.slice(0, 500) ?? null,
    paymentMethodType: type,
    paymentMethodBrand: str(card?.brand) ?? str(card?.network),
    last4: str(card?.last4),
    disputed,
    livemode: o.livemode === true,
    createdAt: tsOf(o.created) ?? new Date(),
  };
}

export function normalizeRefund(o: Raw) {
  const meta = obj(o.metadata);
  const admin = str(meta?.realyAdminId);
  return {
    stripeRefundId: String(o.id),
    stripeChargeId: ref(o.charge),
    stripePaymentIntentId: ref(o.payment_intent),
    stripeCustomerId: ref(o.customer),
    amountMinor: int(o.amount),
    currency: cur(o.currency),
    reason: str(o.reason),
    status: str(o.status) ?? "pending",
    failureReason: str(o.failure_reason),
    createdById: admin && /^[0-9a-f-]{36}$/.test(admin) ? admin : null,
    createdAt: tsOf(o.created) ?? new Date(),
  };
}

export function normalizeDispute(o: Raw) {
  const ev = obj(o.evidence_details);
  return {
    stripeDisputeId: String(o.id),
    stripeChargeId: ref(o.charge),
    stripePaymentIntentId: ref(o.payment_intent),
    amountMinor: int(o.amount),
    currency: cur(o.currency),
    reason: str(o.reason) ?? "general",
    status: str(o.status) ?? "needs_response",
    evidenceDueBy: tsOf(ev?.due_by),
    isChargeRefundable: o.is_charge_refundable === true,
    livemode: o.livemode === true,
    createdAt: tsOf(o.created) ?? new Date(),
  };
}

// ───────────── Upserts ─────────────

export interface SyncResult {
  kind: "invoice" | "payment" | "refund" | "dispute" | "invoice_payment";
  id: string | null;
  organizationId: string | null;
  /** False when the row already held newer state (out-of-order event) or the object was unusable. */
  applied: boolean;
  /** A dispute row was created by this call (drives the evidence-due notice). */
  created?: boolean;
}

async function orgForCustomer(tx: Tx, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const p = await tx.billingProfile.findUnique({ where: { stripeCustomerId: customerId }, select: { organizationId: true } });
  return p?.organizationId ?? null;
}

const stale = (existing: { stripeUpdatedAt: Date } | null, at: Date) => !!existing && existing.stripeUpdatedAt > at;

export async function upsertInvoice(tx: Tx, o: Raw, at: Date): Promise<SyncResult> {
  if (typeof o.id !== "string" || !o.id) return { kind: "invoice", id: null, organizationId: null, applied: false };
  const n = normalizeInvoice(o);
  const existing = await tx.platformInvoice.findUnique({ where: { stripeInvoiceId: n.stripeInvoiceId } });
  if (stale(existing, at)) return { kind: "invoice", id: existing!.id, organizationId: existing!.organizationId, applied: false };
  if (existing && existing.stripeUpdatedAt.getTime() === at.getTime() && FINAL_INVOICE.has(existing.status) && !FINAL_INVOICE.has(n.status)) {
    return { kind: "invoice", id: existing.id, organizationId: existing.organizationId, applied: false };
  }
  const organizationId = (await orgForCustomer(tx, n.stripeCustomerId)) ?? existing?.organizationId ?? null;
  const sub = n.stripeSubscriptionId ? await tx.subscription.findUnique({ where: { stripeSubscriptionId: n.stripeSubscriptionId }, select: { id: true, organizationId: true } }) : null;
  const { legacyPaymentIntentId, legacyChargeId, ...fields } = n;
  const data = { ...fields, organizationId, subscriptionId: sub && sub.organizationId === organizationId ? sub.id : (existing?.subscriptionId ?? null), stripeUpdatedAt: at };
  const row = existing ? await tx.platformInvoice.update({ where: { id: existing.id }, data }) : await tx.platformInvoice.create({ data });
  // Old payload shapes name the payment directly.
  if (legacyChargeId || legacyPaymentIntentId) {
    await tx.platformPayment.updateMany({
      where: { stripeInvoiceId: null, OR: [...(legacyChargeId ? [{ stripeChargeId: legacyChargeId }] : []), ...(legacyPaymentIntentId ? [{ stripePaymentIntentId: legacyPaymentIntentId }] : [])] },
      data: { stripeInvoiceId: row.stripeInvoiceId },
    });
  }
  return { kind: "invoice", id: row.id, organizationId, applied: true };
}

/** Find the payment row of a charge / payment intent (either key may come first). */
async function findPayment(tx: Tx, chargeId: string | null, paymentIntentId: string | null) {
  if (chargeId) {
    const byCharge = await tx.platformPayment.findUnique({ where: { stripeChargeId: chargeId } });
    if (byCharge) return byCharge;
  }
  if (paymentIntentId) return tx.platformPayment.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
  return null;
}

export async function upsertCharge(tx: Tx, o: Raw, at: Date): Promise<SyncResult> {
  if (typeof o.id !== "string" || !o.id) return { kind: "payment", id: null, organizationId: null, applied: false };
  const n = normalizeCharge(o);
  let existing = await tx.platformPayment.findUnique({ where: { stripeChargeId: n.stripeChargeId } });
  let inheritedInvoice: string | null = null;
  if (!existing && n.stripePaymentIntentId) {
    const byIntent = await tx.platformPayment.findUnique({ where: { stripePaymentIntentId: n.stripePaymentIntentId } });
    if (byIntent && !byIntent.stripeChargeId) existing = byIntent; // placeholder written by invoice_payment.paid
    else if (byIntent) {
      // Another charge of the same payment intent (a retry after a failed attempt): the newest charge holds the intent.
      if (byIntent.createdAt <= n.createdAt) {
        await tx.platformPayment.update({ where: { id: byIntent.id }, data: { stripePaymentIntentId: null } });
        inheritedInvoice = byIntent.stripeInvoiceId;
      } else n.stripePaymentIntentId = null;
    }
  }
  if (stale(existing, at)) return { kind: "payment", id: existing!.id, organizationId: existing!.organizationId, applied: false };
  const organizationId = (await orgForCustomer(tx, n.stripeCustomerId)) ?? existing?.organizationId ?? null;
  // Refunds only grow; a late "succeeded" never hides a refund already seen.
  const refundedMinor = existing && existing.refundedMinor > n.refundedMinor ? existing.refundedMinor : n.refundedMinor;
  const disputed = n.disputed || !!existing?.disputed;
  const base = n.status === "refunded" || n.status === "partially_refunded" || n.status === "disputed" ? "succeeded" : n.status;
  const data = {
    ...n,
    refundedMinor,
    disputed,
    status: paymentStatusOf({ status: base, amountMinor: n.amountMinor, refundedMinor, disputed }),
    stripeInvoiceId: n.stripeInvoiceId ?? existing?.stripeInvoiceId ?? inheritedInvoice,
    organizationId,
    stripeUpdatedAt: at,
  };
  const row = existing ? await tx.platformPayment.update({ where: { id: existing.id }, data }) : await tx.platformPayment.create({ data });
  // Refunds / disputes that arrived before their charge.
  await tx.platformRefund.updateMany({ where: { stripeChargeId: row.stripeChargeId, paymentId: null }, data: { paymentId: row.id, organizationId } });
  await tx.platformDispute.updateMany({ where: { stripeChargeId: row.stripeChargeId, paymentId: null }, data: { paymentId: row.id, organizationId } });
  return { kind: "payment", id: row.id, organizationId, applied: true };
}

/** `invoice_payment.paid`: the current API's link between an invoice and the payment intent / charge that paid it. */
export async function linkInvoicePayment(tx: Tx, o: Raw, at: Date): Promise<SyncResult> {
  const invoiceId = ref(o.invoice);
  const payment = obj(o.payment);
  const pi = ref(payment?.payment_intent);
  const ch = ref(payment?.charge);
  if (!invoiceId || (!pi && !ch)) return { kind: "invoice_payment", id: null, organizationId: null, applied: false };
  const invoice = await tx.platformInvoice.findUnique({ where: { stripeInvoiceId: invoiceId }, select: { organizationId: true } });
  const existing = await findPayment(tx, ch, pi);
  if (existing) {
    await tx.platformPayment.update({ where: { id: existing.id }, data: { stripeInvoiceId: invoiceId, organizationId: existing.organizationId ?? invoice?.organizationId ?? null } });
    return { kind: "invoice_payment", id: existing.id, organizationId: existing.organizationId ?? invoice?.organizationId ?? null, applied: true };
  }
  // The charge event has not arrived yet: hold the link on a payment-intent row it will complete.
  if (!pi) return { kind: "invoice_payment", id: null, organizationId: invoice?.organizationId ?? null, applied: false };
  const row = await tx.platformPayment.create({
    data: {
      stripePaymentIntentId: pi,
      stripeInvoiceId: invoiceId,
      organizationId: invoice?.organizationId ?? null,
      status: "pending",
      amountMinor: int(o.amount_paid),
      currency: cur(o.currency),
      livemode: o.livemode === true,
      createdAt: tsOf(o.created) ?? at,
      // Older than any charge event, so the charge always overwrites this placeholder.
      stripeUpdatedAt: new Date(0),
    },
  });
  return { kind: "invoice_payment", id: row.id, organizationId: row.organizationId, applied: true };
}

/** Recompute a payment's refunded amount and status from its synced refunds (never lowers what Stripe reported). */
async function rollUpRefunds(tx: Tx, paymentId: string) {
  const p = await tx.platformPayment.findUnique({ where: { id: paymentId } });
  if (!p) return;
  const sum = await tx.platformRefund.aggregate({ where: { paymentId, status: "succeeded" }, _sum: { amountMinor: true } });
  const refunded = sum._sum.amountMinor ?? 0n;
  if (refunded <= p.refundedMinor) return;
  await tx.platformPayment.update({
    where: { id: p.id },
    data: { refundedMinor: refunded, status: paymentStatusOf({ status: p.status === "failed" || p.status === "pending" ? p.status : "succeeded", amountMinor: p.amountMinor, refundedMinor: refunded, disputed: p.disputed }) },
  });
}

export async function upsertRefund(tx: Tx, o: Raw, at: Date, livemode: boolean, opts: { createdById?: string | null } = {}): Promise<SyncResult> {
  if (typeof o.id !== "string" || !o.id) return { kind: "refund", id: null, organizationId: null, applied: false };
  const n = normalizeRefund(o);
  const existing = await tx.platformRefund.findUnique({ where: { stripeRefundId: n.stripeRefundId } });
  if (stale(existing, at)) return { kind: "refund", id: existing!.id, organizationId: existing!.organizationId, applied: false };
  const payment = await findPayment(tx, n.stripeChargeId, n.stripePaymentIntentId);
  const organizationId = payment?.organizationId ?? (await orgForCustomer(tx, n.stripeCustomerId)) ?? existing?.organizationId ?? null;
  const { stripeCustomerId: _c, ...fields } = n;
  void _c;
  const data = {
    ...fields,
    createdById: existing?.createdById ?? opts.createdById ?? n.createdById,
    paymentId: payment?.id ?? existing?.paymentId ?? null,
    organizationId,
    livemode,
    stripeUpdatedAt: at,
  };
  const row = existing ? await tx.platformRefund.update({ where: { id: existing.id }, data }) : await tx.platformRefund.create({ data });
  if (row.paymentId) await rollUpRefunds(tx, row.paymentId);
  return { kind: "refund", id: row.id, organizationId, applied: true };
}

export async function upsertDispute(tx: Tx, o: Raw, at: Date): Promise<SyncResult> {
  if (typeof o.id !== "string" || !o.id) return { kind: "dispute", id: null, organizationId: null, applied: false };
  const n = normalizeDispute(o);
  const existing = await tx.platformDispute.findUnique({ where: { stripeDisputeId: n.stripeDisputeId } });
  if (stale(existing, at)) return { kind: "dispute", id: existing!.id, organizationId: existing!.organizationId, applied: false };
  const payment = await findPayment(tx, n.stripeChargeId, n.stripePaymentIntentId);
  const organizationId = payment?.organizationId ?? existing?.organizationId ?? null;
  const { stripePaymentIntentId: _pi, ...fields } = n;
  void _pi;
  const data = { ...fields, paymentId: payment?.id ?? existing?.paymentId ?? null, organizationId, stripeUpdatedAt: at };
  const row = existing ? await tx.platformDispute.update({ where: { id: existing.id }, data }) : await tx.platformDispute.create({ data });
  if (payment && !payment.disputed) await tx.platformPayment.update({ where: { id: payment.id }, data: { disputed: true, status: "disputed" } });
  return { kind: "dispute", id: row.id, organizationId, applied: true, created: !existing };
}

/** Apply one verified event's object. Unknown types are ignored (applied: false). */
export async function syncStripeEvent(tx: Tx, event: { type: string; created?: number; livemode: boolean; data: { object: Raw } }): Promise<SyncResult | null> {
  if (!SYNC_EVENT_TYPES.has(event.type)) return null;
  const at = tsOf(event.created) ?? new Date();
  const o = event.data.object;
  if (event.type === "invoice_payment.paid") return linkInvoicePayment(tx, o, at);
  if (event.type.startsWith("invoice.")) return upsertInvoice(tx, o, at);
  if (event.type.startsWith("charge.dispute.")) return upsertDispute(tx, o, at);
  if (event.type.startsWith("refund.") || event.type === "charge.refund.updated") return upsertRefund(tx, o, at, event.livemode);
  if (event.type.startsWith("charge.")) {
    const r = await upsertCharge(tx, o, at);
    // Payloads that still embed the charge's refunds (older API versions) are mirrored too.
    const refunds = obj(o.refunds)?.data;
    if (Array.isArray(refunds)) for (const rf of refunds) if (obj(rf)) await upsertRefund(tx, rf as Raw, at, event.livemode);
    return r;
  }
  return null;
}

/** Upsert one object fetched from a Stripe list API (backfill); `at` is the fetch time. */
export async function syncFetchedObject(tx: Tx, kind: "invoices" | "charges" | "refunds" | "disputes", o: Raw, at: Date, livemode: boolean): Promise<SyncResult> {
  if (kind === "invoices") return upsertInvoice(tx, o, at);
  if (kind === "charges") return upsertCharge(tx, o, at);
  // Refund objects carry no livemode flag; the API key's mode applies.
  if (kind === "refunds") return upsertRefund(tx, o, at, livemode);
  return upsertDispute(tx, o, at);
}
