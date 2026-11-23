import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { setBillingConfigForTests } from "@/server/modules/billing/gateway";
import { handleStripeWebhook } from "@/server/modules/billing/stripe-billing";
import { getPlatformInvoice, getPlatformPayment, listPlatformInvoices, listPlatformPayments } from "@/server/modules/billing/explorers";
import { billingOverview } from "@/server/modules/admin/billing";
import { billingSearch } from "@/server/modules/admin/search/providers/billing";
import { expectCode, makeUser, resetDb } from "../helpers";
import { WEBHOOK_SECRET, adminGateway, billedOrg, clearStreamDTables, event, platformAdmin, signed, uid } from "./admin-d-fixtures";

beforeAll(async () => {
  await resetDb();
  await clearStreamDTables();
});
afterEach(() => setBillingConfigForTests(undefined));

const configure = () => setBillingConfigForTests({ gateway: adminGateway().gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
const deliver = async (type: string, object: Record<string, unknown>, created?: number) => {
  const e = event(type, object, created);
  const { payload, signature } = signed(e);
  return { e, r: await handleStripeWebhook(payload, signature), payload, signature };
};

describe("Stripe mirror (webhook-driven, idempotent)", () => {
  it("mirrors invoices, charges, refunds and disputes into the platform tables, matched to the organization", async () => {
    configure();
    const { org, customerId } = await billedOrg();
    const inv = uid("in");
    const ch = uid("ch");
    const pi = uid("pi");
    const t0 = Math.floor(Date.now() / 1000) - 100;
    await deliver("invoice.finalized", { id: inv, object: "invoice", customer: customerId, status: "open", currency: "usd", subtotal: 5000, total: 5000, amount_due: 5000, amount_paid: 0, amount_remaining: 5000, created: t0, number: "INV-1" }, t0);
    await deliver("charge.succeeded", { id: ch, object: "charge", customer: customerId, payment_intent: pi, amount: 5000, amount_refunded: 0, currency: "usd", status: "succeeded", payment_method_details: { type: "card", card: { brand: "visa", last4: "4242" } }, created: t0 + 1 }, t0 + 1);
    const paid = await deliver("invoice.paid", { id: inv, object: "invoice", customer: customerId, status: "paid", currency: "usd", subtotal: 5000, total: 5000, amount_due: 5000, amount_paid: 5000, amount_remaining: 0, created: t0, number: "INV-1", status_transitions: { paid_at: t0 + 2 } }, t0 + 2);
    expect(paid.r.status).toBe(200);
    await deliver("invoice_payment.paid", { id: uid("inpay"), object: "invoice_payment", invoice: inv, payment: { type: "payment_intent", payment_intent: pi }, amount_paid: 5000, currency: "usd", created: t0 + 2 }, t0 + 3);

    const invoice = await db().platformInvoice.findUniqueOrThrow({ where: { stripeInvoiceId: inv } });
    expect(invoice).toMatchObject({ organizationId: org.id, status: "paid", amountPaidMinor: 5000n, amountRemainingMinor: 0n, number: "INV-1" });
    const payment = await db().platformPayment.findUniqueOrThrow({ where: { stripeChargeId: ch } });
    expect(payment).toMatchObject({ organizationId: org.id, status: "succeeded", stripeInvoiceId: inv, paymentMethodBrand: "visa", last4: "4242" });

    // A refund made in the Stripe dashboard, then the dispute.
    const re = uid("re");
    await deliver("refund.created", { id: re, object: "refund", charge: ch, payment_intent: pi, amount: 2000, currency: "usd", status: "succeeded", created: t0 + 4 }, t0 + 4);
    const after = await db().platformPayment.findUniqueOrThrow({ where: { stripeChargeId: ch } });
    expect(after).toMatchObject({ refundedMinor: 2000n, status: "partially_refunded" });
    expect(await db().platformRefund.findUniqueOrThrow({ where: { stripeRefundId: re } })).toMatchObject({ paymentId: payment.id, organizationId: org.id, createdById: null });

    const dp = uid("dp");
    await deliver("charge.dispute.created", { id: dp, object: "dispute", charge: ch, amount: 3000, currency: "usd", reason: "fraudulent", status: "needs_response", evidence_details: { due_by: t0 + 86400 * 5 }, created: t0 + 5 }, t0 + 5);
    expect(await db().platformDispute.findUniqueOrThrow({ where: { stripeDisputeId: dp } })).toMatchObject({ paymentId: payment.id, organizationId: org.id, status: "needs_response" });
    expect((await db().platformPayment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("disputed");

    const admin = await platformAdmin("FINANCE_ADMIN");
    const detail = await getPlatformInvoice(admin.ctx, invoice.id);
    expect(detail.payments.map((p) => p.id)).toEqual([payment.id]);
    expect((await getPlatformPayment(admin.ctx, payment.id)).refundableMinor).toBe(3000n);
    expect((await listPlatformInvoices(admin.ctx, { org: org.id })).page.data.map((i) => i.id)).toEqual([invoice.id]);
    expect((await listPlatformPayments(admin.ctx, { status: "disputed" })).page.data.some((p) => p.id === payment.id)).toBe(true);
    const overview = await billingOverview(admin.ctx, { days: 30 });
    expect(overview.gross.find((g) => g.currency === "USD")?.amountMinor).toBe(5000n);
    expect(overview.refunds.find((g) => g.currency === "USD")?.amountMinor).toBe(2000n);
    expect(overview.net.find((g) => g.currency === "USD")?.amountMinor).toBe(3000n);
    expect(overview.openDisputes).toBeGreaterThanOrEqual(1);
    const found = await billingSearch.search(admin.ctx, inv);
    expect(found.invoices.map((i) => i.id)).toEqual([invoice.id]);
    expect((await billingSearch.search(admin.ctx, ch)).payments.map((p) => p.id)).toEqual([payment.id]);
  });

  it("replays are no-ops and an older event never overwrites newer state", async () => {
    configure();
    const { customerId } = await billedOrg();
    const inv = uid("in");
    const t = Math.floor(Date.now() / 1000);
    const first = await deliver("invoice.paid", { id: inv, object: "invoice", customer: customerId, status: "paid", currency: "eur", subtotal: 100, total: 100, amount_paid: 100, amount_due: 100, created: t - 50 }, t);
    const again = await handleStripeWebhook(first.payload, first.signature);
    expect(again.body).toMatchObject({ duplicate: true });
    // invoice.finalized (status open) created earlier but delivered later: ignored.
    await deliver("invoice.finalized", { id: inv, object: "invoice", customer: customerId, status: "open", currency: "eur", subtotal: 100, total: 100, amount_paid: 0, amount_due: 100, created: t - 50 }, t - 10);
    expect((await db().platformInvoice.findUniqueOrThrow({ where: { stripeInvoiceId: inv } })).status).toBe("paid");
    expect(await db().platformInvoice.count({ where: { stripeInvoiceId: inv } })).toBe(1);
  });

  it("records objects of unknown customers without assigning them to an organization", async () => {
    configure();
    const ch = uid("ch");
    const { r } = await deliver("charge.failed", { id: ch, object: "charge", customer: "cus_unknown", amount: 900, currency: "usd", status: "failed", failure_code: "card_declined", created: Math.floor(Date.now() / 1000) });
    expect(r.body).toMatchObject({ outcome: "applied" });
    expect(await db().platformPayment.findUniqueOrThrow({ where: { stripeChargeId: ch } })).toMatchObject({ organizationId: null, status: "failed", failureCode: "card_declined" });
  });

  it("explorers are platform-only", async () => {
    const outsider = await makeUser();
    await expectCode(listPlatformInvoices(outsider.ctx, {}), "forbidden");
    await expectCode(listPlatformPayments(outsider.ctx, {}), "forbidden");
  });
});
