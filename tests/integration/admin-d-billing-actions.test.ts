import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { setBillingConfigForTests } from "@/server/modules/billing/gateway";
import { adminSubscriptionCancel, adminSubscriptionExtendTrial, adminSubscriptionPause, backfillStripe, issueRefund } from "@/server/modules/billing/admin-actions";
import { getSubscriptionDetail } from "@/server/modules/admin/billing";
import { archivePlan, clonePlan, publishPlan, setPromotionStatus, createPromotion } from "@/server/modules/pricing/service";
import { expectCode, resetDb } from "../helpers";
import { WEBHOOK_SECRET, adminGateway, billedOrg, clearStreamDTables, liveSubscription, platformAdmin, uid } from "./admin-d-fixtures";

beforeAll(async () => {
  await resetDb();
  await clearStreamDTables();
});
afterEach(() => setBillingConfigForTests(undefined));

async function syncedPayment(organizationId: string, amount = 10_000n) {
  return db().platformPayment.create({
    data: { organizationId, stripeChargeId: uid("ch"), stripePaymentIntentId: uid("pi"), status: "succeeded", amountMinor: amount, currency: "USD", createdAt: new Date(), stripeUpdatedAt: new Date() },
  });
}

describe("refunds (real Stripe call behind platform.billing.refund, MFA, confirmation, reason, audit)", () => {
  it("refunds part of a payment, records the refund from Stripe's answer and audits it", async () => {
    const g = adminGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { org } = await billedOrg();
    const p = await syncedPayment(org.id);
    const admin = await platformAdmin("BILLING_ADMIN");
    const r = await issueRefund(admin.ctx, { paymentId: p.id, amountMinor: "2500", stripeReason: "requested_by_customer", reason: "Customer asked for partial refund", confirm: p.stripeChargeId! });
    expect(r.status).toBe("succeeded");
    const call = g.calls.find((c) => c.op === "createRefund")!;
    expect(call.args[0]).toMatchObject({ chargeId: p.stripeChargeId, amountMinor: 2500n, metadata: { realyAdminId: admin.user.id, realyPaymentId: p.id } });
    expect(await db().platformRefund.findUniqueOrThrow({ where: { id: r.refundId } })).toMatchObject({ paymentId: p.id, createdById: admin.user.id, amountMinor: 2500n });
    expect(await db().platformPayment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ refundedMinor: 2500n, status: "partially_refunded" });
    expect(await db().auditLog.count({ where: { action: "billing.refund.issued", resourceId: p.id, reason: "Customer asked for partial refund" } })).toBe(1);

    // Cannot exceed what is left (7,500).
    await expectCode(issueRefund(admin.ctx, { paymentId: p.id, amountMinor: "8000", reason: "too much", confirm: p.stripeChargeId! }), "validation_error");
  });

  it("refuses without the permission, without MFA, or without the typed charge id", async () => {
    const g = adminGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { org } = await billedOrg();
    const p = await syncedPayment(org.id);
    const finance = await platformAdmin("FINANCE_ADMIN");
    await expectCode(issueRefund(finance.ctx, { paymentId: p.id, amountMinor: "100", reason: "nope", confirm: p.stripeChargeId! }), "forbidden");
    const noMfa = await platformAdmin("BILLING_ADMIN", { mfa: false });
    await expectCode(issueRefund(noMfa.ctx, { paymentId: p.id, amountMinor: "100", reason: "nope", confirm: p.stripeChargeId! }), "mfa_required");
    const admin = await platformAdmin("BILLING_ADMIN");
    await expectCode(issueRefund(admin.ctx, { paymentId: p.id, amountMinor: "100", reason: "wrong phrase", confirm: "ch_wrong" }), "validation_error");
    expect(g.calls.filter((c) => c.op === "createRefund")).toHaveLength(0);
  });

  it("a Stripe failure is audited and surfaced; nothing is recorded as refunded", async () => {
    const g = adminGateway();
    g.fail.refund = true;
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { org } = await billedOrg();
    const p = await syncedPayment(org.id);
    const admin = await platformAdmin("BILLING_ADMIN");
    await expectCode(issueRefund(admin.ctx, { paymentId: p.id, amountMinor: "100", reason: "try it", confirm: p.stripeChargeId! }), "service_unavailable");
    expect(await db().platformRefund.count({ where: { paymentId: p.id } })).toBe(0);
    expect(await db().auditLog.count({ where: { action: "billing.refund.failed", resourceId: p.id } })).toBe(1);
  });

  it("without Stripe the action says not configured (never simulated)", async () => {
    setBillingConfigForTests(null);
    const { org } = await billedOrg();
    const p = await syncedPayment(org.id);
    const admin = await platformAdmin("BILLING_ADMIN");
    await expectCode(issueRefund(admin.ctx, { paymentId: p.id, amountMinor: "100", reason: "no stripe", confirm: p.stripeChargeId! }), "not_configured");
  });
});

describe("subscription actions", () => {
  it("pause, trial extension and immediate cancellation call Stripe and are audited; nothing changes locally", async () => {
    const g = adminGateway();
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { org } = await billedOrg();
    const sub = await liveSubscription(org.id, { status: "TRIALING" });
    const admin = await platformAdmin("BILLING_ADMIN");
    await adminSubscriptionPause(admin.ctx, sub.id, { behavior: "keep_as_draft", reason: "Customer requested a pause" });
    expect(g.calls.find((c) => c.op === "setPauseCollection")!.args.slice(0, 2)).toEqual([sub.stripeSubscriptionId, "keep_as_draft"]);

    await expectCode(adminSubscriptionExtendTrial(admin.ctx, sub.id, { trialEndsAt: new Date(Date.now() + 86_400_000), reason: "shorter is refused" }), "validation_error");
    const later = new Date(Date.now() + 10 * 86_400_000);
    await adminSubscriptionExtendTrial(admin.ctx, sub.id, { trialEndsAt: later, reason: "Pilot needs more time" });
    expect(g.calls.find((c) => c.op === "setTrialEnd")!.args[1]).toBe(Math.floor(later.getTime() / 1000));

    await expectCode(adminSubscriptionCancel(admin.ctx, sub.id, { mode: "immediately", reason: "Fraud", confirm: "wrong-slug" }), "validation_error");
    await adminSubscriptionCancel(admin.ctx, sub.id, { mode: "immediately", reason: "Fraud", confirm: org.slug });
    expect(g.calls.some((c) => c.op === "cancelSubscriptionNow")).toBe(true);
    expect((await db().subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("TRIALING"); // the webhook applies it
    const detail = await getSubscriptionDetail(admin.ctx, sub.id);
    expect(detail.audit.map((a) => a.action)).toEqual(expect.arrayContaining(["billing.subscription.pause_requested", "billing.subscription.trial_extend_requested", "billing.subscription.cancel_now_requested"]));
    expect(detail.monthlyMinor).toBe(sub.items[0]!.unitAmountMinor);
  });

  it("read-only admins cannot act", async () => {
    setBillingConfigForTests({ gateway: adminGateway().gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const { org } = await billedOrg();
    const sub = await liveSubscription(org.id);
    const finance = await platformAdmin("FINANCE_ADMIN");
    await expectCode(adminSubscriptionPause(finance.ctx, sub.id, { behavior: "void", reason: "not allowed" }), "forbidden");
  });
});

describe("backfill", () => {
  it("copies Stripe list pages into the mirror, continues with a cursor, and is idempotent", async () => {
    const g = adminGateway();
    const { org, customerId } = await billedOrg();
    const now = Math.floor(Date.now() / 1000);
    g.pages.set("invoices", Array.from({ length: 320 }, (_, i) => ({ id: `in_bf${i}_${now}`, object: "invoice", customer: customerId, status: "paid", currency: "usd", subtotal: 100, total: 100, amount_paid: 100, amount_due: 100, created: now - i })));
    setBillingConfigForTests({ gateway: g.gateway, webhookSecret: WEBHOOK_SECRET, automaticTax: false });
    const admin = await platformAdmin("BILLING_ADMIN");
    const first = await backfillStripe(admin.ctx, { kind: "invoices", sinceDays: 30, reason: "Initial import" });
    expect(first).toMatchObject({ processed: 300, hasMore: true });
    const second = await backfillStripe(admin.ctx, { kind: "invoices", sinceDays: 30, reason: "Initial import", startingAfter: first.nextCursor! });
    expect(second).toMatchObject({ processed: 20, hasMore: false, nextCursor: null });
    expect(await db().platformInvoice.count({ where: { organizationId: org.id } })).toBe(320);
    await backfillStripe(admin.ctx, { kind: "invoices", sinceDays: 30, reason: "Repeat" });
    expect(await db().platformInvoice.count({ where: { organizationId: org.id } })).toBe(320);
    expect(await db().auditLog.count({ where: { action: "billing.stripe_backfill" } })).toBe(3);
  });
});

describe("plan lifecycle", () => {
  it("clone → publish → archive, with entitlements copied and guards", async () => {
    const admin = await platformAdmin("SUPER_ADMIN");
    const src = await db().plan.findUniqueOrThrow({ where: { key: "growth" }, include: { entitlements: true } });
    const { plan, entitlements, prices } = await clonePlan(admin.ctx, src.id, { key: `growth-eu-${Date.now().toString(36)}`, name: "Growth EU", withPrices: true, reason: "Regional variant" });
    expect(plan).toMatchObject({ status: "DRAFT", public: false });
    expect(entitlements).toBe(src.entitlements.length);
    expect(prices).toBeGreaterThan(0);
    expect(await db().planEntitlement.count({ where: { planId: plan.id } })).toBe(src.entitlements.length);
    await publishPlan(admin.ctx, plan.id, { reason: "Launch" });
    expect((await db().plan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("ACTIVE");
    await expectCode(archivePlan(admin.ctx, plan.id, { reason: "Retire", confirm: "wrong" }), "validation_error");
    await archivePlan(admin.ctx, plan.id, { reason: "Retire", confirm: plan.key });
    expect(await db().plan.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({ status: "DISABLED", public: false });

    const bare = await clonePlan(admin.ctx, src.id, { key: `bare-${Date.now().toString(36)}`, name: "Bare", withPrices: false, reason: "No prices" });
    await expectCode(publishPlan(admin.ctx, bare.plan.id, { reason: "Launch" }), "validation_error");
  });

  it("promotions can be disabled with a reason", async () => {
    const admin = await platformAdmin("SUPER_ADMIN");
    const p = await createPromotion(admin.ctx, { name: "Spring", discountType: "PERCENT", percentOffBps: 1000, startsAt: new Date(Date.now() - 1000), couponCode: `SPRING${Date.now().toString(36).toUpperCase()}`, reason: "launch" });
    await setPromotionStatus(admin.ctx, p.id, { status: "INACTIVE", reason: "Ended early" });
    expect((await db().promotion.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("INACTIVE");
  });
});
