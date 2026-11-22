import type { PeriodicJob } from "@/server/core/module-jobs";
import { logger } from "@/server/core/logger";

/**
 * Stream E operations jobs (Control Center health, alerts, retention, integrity). Intervals stay at 5 minutes or more:
 * each tick costs Redis commands (scheduler bookkeeping, one PING, queue depths every third tick) and Upstash bills
 * per command.
 */

const log = logger.child({ component: "ops-jobs" });

/** Health probes, then alert rules over the fresh probe rows. Returns the number of probe rows written. */
async function monitor(): Promise<number> {
  const { runHealthProbes } = await import("@/server/modules/admin/health");
  const { evaluateAlertRules } = await import("@/server/modules/admin/alerts");
  const probes = await runHealthProbes();
  const summary = await evaluateAlertRules();
  if (summary.created || summary.resolved || summary.suppressed) log.info({ probes, created: summary.created, resolved: summary.resolved, suppressed: summary.suppressed }, "ops monitor");
  return probes + summary.created + summary.resolved;
}

async function retention(): Promise<number> {
  const [{ purgeHealthChecks }, { purgeLogs }, { purgeResolvedAlerts }] = await Promise.all([import("@/server/modules/admin/health"), import("@/server/modules/admin/logs"), import("@/server/modules/admin/alerts")]);
  return (await purgeHealthChecks()) + (await purgeLogs()) + (await purgeResolvedAlerts());
}

async function integrity(): Promise<number> {
  const { runIntegrityChecks } = await import("@/server/modules/admin/data-ops");
  const results = await runIntegrityChecks();
  return results.filter((r) => (r.count ?? 0) > 0).length;
}

/** Stream F: API request logs and rate-limit events past their 14-day retention (DB only). */
async function apiLogsRetention(): Promise<number> {
  const { purgeApiLogs } = await import("@/server/modules/admin/api-logs");
  const r = await purgeApiLogs();
  return r.logs + r.events;
}

export const OPS_JOBS: PeriodicJob[] = [
  { name: "ops.monitor", everyMs: 5 * 60_000, run: monitor },
  { name: "ops.retention", everyMs: 6 * 3_600_000, run: retention },
  { name: "ops.integrity", everyMs: 24 * 3_600_000, run: integrity },
  { name: "admin.api_logs_retention", everyMs: 24 * 3_600_000, run: apiLogsRetention },
];
