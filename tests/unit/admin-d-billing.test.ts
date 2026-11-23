import { describe, expect, it } from "vitest";
import { normalizeCharge, normalizeDispute, normalizeInvoice, normalizeRefund, paymentStatusOf, SYNC_EVENT_TYPES } from "@/server/modules/billing/stripe-sync";
import { mrrMovement } from "@/server/modules/billing/mrr";
import { weekStart } from "@/server/modules/admin/growth";

describe("stripe mirror normalizers", () => {
  it("reads the current invoice shape (parent.subscription_details, total_taxes, discounts)", () => {
    const n = normalizeInvoice({
      id: "in_1",
      customer: "cus_1",
      parent: { subscription_details: { subscription: "sub_1" } },
      number: "R-0001",
      status: "paid",
      billing_reason: "subscription_cycle",
      currency: "eur",
      subtotal: 10000,
      total: 9900,
      total_discount_amounts: [{ amount: 1000 }],
      total_taxes: [{ amount: 900 }],
      amount_paid: 9900,
      amount_due: 9900,
      amount_remaining: 0,
      attempt_count: 1,
      status_transitions: { paid_at: 1_700_000_100 },
      created: 1_700_000_000,
      livemode: true,
    });
    expect(n).toMatchObject({ stripeSubscriptionId: "sub_1", currency: "EUR", subtotalMinor: 10000n, discountMinor: 1000n, taxMinor: 900n, taxKnown: true, totalMinor: 9900n, amountRemainingMinor: 0n, livemode: true });
    expect(n.paidAt?.getTime()).toBe(1_700_000_100_000);
  });

  it("reads the pre-basil invoice shape and never invents tax", () => {
    const n = normalizeInvoice({ id: "in_2", subscription: { id: "sub_2" }, status: "open", currency: "usd", subtotal: 500, total: 500, amount_due: 500, amount_paid: 0, payment_intent: "pi_2", charge: "ch_2", created: 1 });
    expect(n).toMatchObject({ stripeSubscriptionId: "sub_2", taxKnown: false, taxMinor: 0n, amountRemainingMinor: 500n, legacyPaymentIntentId: "pi_2", legacyChargeId: "ch_2" });
    expect(normalizeInvoice({ id: "in_3", total: 1 }).status).toBe("draft");
  });

  it("derives payment status from refunds and disputes", () => {
    expect(paymentStatusOf({ status: "succeeded", amountMinor: 100n, refundedMinor: 0n, disputed: false })).toBe("succeeded");
    expect(paymentStatusOf({ status: "succeeded", amountMinor: 100n, refundedMinor: 40n, disputed: false })).toBe("partially_refunded");
    expect(paymentStatusOf({ status: "succeeded", amountMinor: 100n, refundedMinor: 100n, disputed: false })).toBe("refunded");
    expect(paymentStatusOf({ status: "succeeded", amountMinor: 100n, refundedMinor: 0n, disputed: true })).toBe("disputed");
    expect(paymentStatusOf({ status: "failed", amountMinor: 100n, refundedMinor: 0n, disputed: false })).toBe("failed");
    expect(paymentStatusOf({ status: null, amountMinor: 100n, refundedMinor: 0n, disputed: false })).toBe("pending");
  });

  it("keeps only brand and last 4 of the card", () => {
    const c = normalizeCharge({ id: "ch_1", payment_intent: "pi_1", customer: "cus_1", amount: 2500, amount_refunded: 0, currency: "inr", status: "succeeded", payment_method_details: { type: "card", card: { brand: "visa", last4: "4242", fingerprint: "secret-ish", exp_month: 1 } }, created: 1 });
    expect(c).toMatchObject({ paymentMethodType: "card", paymentMethodBrand: "visa", last4: "4242", currency: "INR", status: "succeeded" });
    expect(JSON.stringify(c, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("secret-ish");
  });

  it("reads refunds (admin attribution only from a uuid) and disputes", () => {
    expect(normalizeRefund({ id: "re_1", charge: "ch_1", amount: 100, currency: "usd", status: "succeeded", metadata: { realyAdminId: "not-a-uuid" } }).createdById).toBeNull();
    expect(normalizeRefund({ id: "re_2", charge: { id: "ch_1" }, amount: 100, currency: "usd", metadata: { realyAdminId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" } })).toMatchObject({ stripeChargeId: "ch_1", status: "pending", createdById: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" });
    const d = normalizeDispute({ id: "dp_1", charge: "ch_1", amount: 900, currency: "eur", reason: "fraudulent", status: "needs_response", evidence_details: { due_by: 1_800_000_000 }, is_charge_refundable: true });
    expect(d).toMatchObject({ stripeChargeId: "ch_1", amountMinor: 900n, isChargeRefundable: true });
    expect(d.evidenceDueBy?.getTime()).toBe(1_800_000_000_000);
  });

  it("subscribes to the events the mirror needs", () => {
    for (const t of ["invoice.created", "invoice.finalized", "invoice.paid", "invoice.payment_failed", "invoice.voided", "invoice.marked_uncollectible", "charge.succeeded", "charge.failed", "charge.refunded", "charge.dispute.created", "charge.dispute.closed", "refund.updated", "invoice_payment.paid"]) {
      expect(SYNC_EVENT_TYPES.has(t)).toBe(true);
    }
  });
});

describe("MRR movement", () => {
  const m = (o: Record<string, number>) => new Map(Object.entries(o).map(([k, v]) => [k, BigInt(v)]));
  it("splits new, expansion, contraction, churn and reactivation", () => {
    const mv = mrrMovement(m({ a: 100, b: 200, c: 300 }), m({ a: 150, b: 100, d: 50, e: 70 }), new Set(["e"]));
    expect(mv).toEqual({ newMinor: 50n, expansionMinor: 50n, contractionMinor: 100n, churnMinor: 300n, reactivationMinor: 70n, newOrgs: 1, churnedOrgs: 1 });
  });
  it("reports nothing when nothing changed", () => {
    expect(mrrMovement(m({ a: 1 }), m({ a: 1 }), new Set())).toMatchObject({ newMinor: 0n, churnMinor: 0n, expansionMinor: 0n, contractionMinor: 0n });
  });
});

describe("growth helpers", () => {
  it("weeks start on Monday (UTC)", () => {
    expect(weekStart(new Date("2026-11-22T12:00:00Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(weekStart(new Date("2026-11-16T00:00:00Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });
});
