import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { adjustCredits, creditBalances, creditLedger, creditReconciliation, quotaEvents, usageCenter } from "@/server/modules/admin/credits";
import { computeDailyMetrics, platformAnalytics } from "@/server/modules/admin/analytics";
import { growthOverview } from "@/server/modules/admin/growth";
import { revenueAnalytics } from "@/server/modules/admin/revenue";
import { computeMrrSnapshot, utcDay } from "@/server/modules/billing/mrr";
import { grantAddon } from "@/server/modules/entitlements/admin";
import { aggregateUsageIntoLedger, grantPlanPeriods } from "@/server/modules/entitlements/ledger-jobs";
import { assertLimit, checkLimit, getEntitlements, invalidateEntitlements, recordUsage } from "@/server/modules/entitlements/service";
import { expectCode, resetDb } from "../helpers";
import { billedOrg, clearStreamDTables, liveSubscription, platformAdmin } from "./admin-d-fixtures";

beforeAll(async () => {
  await resetDb();
  await clearStreamDTables();
});

describe("credit ledger", () => {
  it("admin adjustments change the enforced allowance and are attributed and audited", async () => {
    const { org } = await billedOrg();
    await liveSubscription(org.id, { planKey: "growth" });
    invalidateEntitlements(org.id);
    const before = (await checkLimit(org.id, "ai.credits.month", 0)).limit!;
    const admin = await platformAdmin("BILLING_ADMIN");
    await adjustCredits(admin.ctx, { organizationId: org.id, meter: "ai.credits", kind: "PROMOTION", delta: "5000", reason: "Launch promotion" });
    expect((await checkLimit(org.id, "ai.credits.month", 0)).limit).toBe(before + 5000);
    await adjustCredits(admin.ctx, { organizationId: org.id, meter: "ai.credits", kind: "ADJUSTMENT", delta: "-1000", reason: "Correction" });
    expect((await checkLimit(org.id, "ai.credits.month", 0)).limit).toBe(before + 4000);
    await expect(adjustCredits(admin.ctx, { organizationId: org.id, meter: "ai.credits", kind: "REFUND", delta: "-5", reason: "negative refund" })).rejects.toThrow(/Refunds and promotions add credits/);
    await expectCode(adjustCredits(admin.ctx, { organizationId: org.id, meter: "ai.credits", kind: "ADJUSTMENT", delta: String(-(before + 10_000)), reason: "too much" }), "validation_error");
    const finance = await platformAdmin("FINANCE_ADMIN");
    await expectCode(adjustCredits(finance.ctx, { organizationId: org.id, meter: "ai.credits", kind: "ADJUSTMENT", delta: "10", reason: "read only" }), "forbidden");

    const ledger = await creditLedger(admin.ctx, { org: org.id });
    expect(ledger.page.data.map((e) => [e.kind, e.delta, e.actorId])).toEqual([
      ["ADJUSTMENT", -1000n, admin.user.id],
      ["PROMOTION", 5000n, admin.user.id],
    ]);
    expect(await db().auditLog.count({ where: { organizationId: org.id, action: "credits.adjusted" } })).toBe(2);
    const bal = await creditBalances(admin.ctx, org.id);
    expect(bal.meters.find((m) => m.meter === "ai.credits")).toMatchObject({ ledger: 4000, limit: before + 4000 });
  });

  it("add-on grants, plan period grants and daily usage land in the ledger; reconciliation finds nothing missing", async () => {
    const { org } = await billedOrg();
    await liveSubscription(org.id, { planKey: "growth" });
    invalidateEntitlements(org.id);
    const admin = await platformAdmin("SUPER_ADMIN");
    const addon = await grantAddon(admin.ctx, { organizationId: org.id, addonKey: "addon.ai_credits_10k", packs: 1, reason: "Pilot goodwill" });
    expect(await db().creditLedgerEntry.findFirstOrThrow({ where: { sourceType: "addon_purchase", sourceId: addon.id } })).toMatchObject({ kind: "GRANT", delta: 10_000n, actorId: admin.user.id });

    const yesterday = new Date(utcDay().getTime() - 86_400_000 + 3_600_000);
    await recordUsage(org.id, "ai.credits", 1234, { occurredAt: yesterday });
    await recordUsage(org.id, "ai.credits", 66, { occurredAt: yesterday });
    expect(await aggregateUsageIntoLedger()).toBeGreaterThanOrEqual(1);
    await aggregateUsageIntoLedger(); // idempotent re-run
    const usage = await db().creditLedgerEntry.findMany({ where: { organizationId: org.id, kind: "USAGE" } });
    expect(usage).toHaveLength(1);
    expect(usage[0]!.delta).toBe(-1300n);

    expect(await grantPlanPeriods()).toBeGreaterThanOrEqual(1);
    const grants = await db().creditLedgerEntry.count({ where: { organizationId: org.id, kind: "GRANT", sourceType: "plan_period" } });
    expect(grants).toBeGreaterThan(0);
    await grantPlanPeriods();
    expect(await db().creditLedgerEntry.count({ where: { organizationId: org.id, kind: "GRANT", sourceType: "plan_period" } })).toBe(grants);

    const recon = await creditReconciliation(admin.ctx);
    expect(recon.usage.filter((u) => u.organizationId === org.id)).toEqual([]);
    expect(recon.addons.filter((a) => a.organizationId === org.id)).toEqual([]);
  });

  it("blocked limit checks are persisted as quota events (throttled)", async () => {
    const { org } = await billedOrg();
    await liveSubscription(org.id, { planKey: "starter" });
    invalidateEntitlements(org.id);
    const ent = await getEntitlements(org.id);
    const limit = ent.limits["ai.credits.month"]!;
    await expectCode(assertLimit(null, org.id, "ai.credits.month", limit + 1), "not_available");
    await expectCode(assertLimit(null, org.id, "ai.credits.month", limit + 1), "not_available");
    const admin = await platformAdmin("FINANCE_ADMIN");
    const events = await quotaEvents(admin.ctx, { org: org.id });
    expect(events.page.data).toHaveLength(1);
    expect(events.page.data[0]).toMatchObject({ limitKey: "ai.credits.month", blocked: true, reason: "plan_limit_reached", increment: BigInt(limit + 1) });
    const center = await usageCenter(admin.ctx, { days: 7, category: "credits" });
    expect(center.categories.map((c) => c.key)).toContain("workflowRuns");
  });
});

describe("snapshots", () => {
  it("MRR snapshots: the first is a baseline, later ones carry movement", async () => {
    await db().mrrSnapshot.deleteMany();
    const day = utcDay();
    await computeMrrSnapshot();
    const base = await db().mrrSnapshot.findMany({ where: { day } });
    expect(base.length).toBeGreaterThan(0);
    expect(base.every((b) => b.baseline)).toBe(true);
    // Move today's snapshot to yesterday, add a paying customer, recompute today.
    await db().mrrSnapshot.updateMany({ where: { day }, data: { day: new Date(day.getTime() - 86_400_000) } });
    const { org } = await billedOrg();
    const sub = await liveSubscription(org.id, { planKey: "scale" });
    await computeMrrSnapshot();
    const today = await db().mrrSnapshot.findUniqueOrThrow({ where: { day_currency: { day, currency: sub.currency } } });
    expect(today.baseline).toBe(false);
    expect(today.newMinor).toBe(sub.items[0]!.unitAmountMinor);
    expect(today.newOrgs).toBe(1);
    const admin = await platformAdmin("FINANCE_ADMIN");
    const a = await revenueAnalytics(admin.ctx, { days: 30, currency: sub.currency });
    expect(a.state).toBe("ok");
    if (a.state === "ok") {
      expect(a.totals.newMinor).toBe(sub.items[0]!.unitAmountMinor);
      expect(a.ltv.minor).toBeNull(); // not enough history to be meaningful
      expect(a.ltv.reasons).toContain("history");
    }
  });

  it("daily platform metrics are written for today only; history before the first snapshot is null", async () => {
    await db().platformDailyMetric.deleteMany();
    expect(await computeDailyMetrics()).toBeGreaterThan(10);
    const admin = await platformAdmin("SUPER_ADMIN");
    const a = await platformAnalytics(admin.ctx, { days: 30 });
    expect(a.firstSnapshot?.toISOString().slice(0, 10)).toBe(utcDay().toISOString().slice(0, 10));
    expect(a.series["users.dau"].slice(0, -1).every((v) => v === null)).toBe(true);
    expect(a.latest["users.total"]).toBeGreaterThan(0);
    const g = await growthOverview(admin.ctx, { days: 30 });
    expect(g.signups.total).toBeGreaterThan(0);
    expect(g.funnel[0]!.step).toBe("signedUp");
    expect(g.attribution.tracked).toBe(false);
  });
});
