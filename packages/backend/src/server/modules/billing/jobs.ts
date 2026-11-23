import type { ModuleJobs } from "@/server/core/module-jobs";
import { db } from "@/server/core/db";
import { notifyAdmins } from "@/server/modules/admin/notifications";
import { computeDailyMetrics } from "@/server/modules/admin/analytics";
import { aggregateUsageIntoLedger, expireClosedPeriods, grantPlanPeriods } from "@/server/modules/entitlements/ledger-jobs";
import { OPEN_DISPUTE_STATUSES } from "./explorers";
import { computeMrrSnapshot } from "./mrr";

const HOUR = 60 * 60_000;

/** Disputes whose evidence is due within 3 days: one admin notice per dispute and day (deduplicated by stream A). */
async function disputeDeadlines(): Promise<number> {
  const soon = new Date(Date.now() + 3 * 24 * HOUR);
  const due = await db().platformDispute.findMany({ where: { status: { in: OPEN_DISPUTE_STATUSES }, evidenceDueBy: { gt: new Date(), lte: soon } }, select: { id: true, evidenceDueBy: true }, take: 100 });
  const day = new Date().toISOString().slice(0, 10);
  for (const d of due) {
    await notifyAdmins(null, { permission: "platform.billing.refund", type: "billing.dispute_evidence_due", severity: "WARNING", title: "Dispute evidence due soon", href: `/payments/disputes/${d.id}`, dedupeKey: `dispute-due:${d.id}:${day}`, payload: { evidenceDueBy: d.evidenceDueBy?.toISOString() } });
  }
  return due.length;
}

/**
 * Background work of billing and platform analytics (stream D). Low frequency and database-only (no Stripe calls,
 * no Redis loops beyond the scheduler's own lock). Registered by stream E in src/worker/modules.ts.
 */
export const BILLING_JOBS: ModuleJobs = {
  periodic: [
    { name: "billing.mrr-snapshot", everyMs: 6 * HOUR, run: () => computeMrrSnapshot() },
    { name: "billing.daily-metrics", everyMs: HOUR, run: () => computeDailyMetrics() },
    { name: "billing.credit-ledger", everyMs: 6 * HOUR, run: async () => (await aggregateUsageIntoLedger()) + (await grantPlanPeriods()) + (await expireClosedPeriods()) },
    { name: "billing.dispute-deadlines", everyMs: 6 * HOUR, run: () => disputeDeadlines() },
  ],
  onEvent: [],
};
