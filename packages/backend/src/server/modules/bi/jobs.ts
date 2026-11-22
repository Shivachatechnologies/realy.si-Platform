import type { ModuleJobs } from "@/server/core/module-jobs";
import { GROWTH_JOBS } from "@/server/modules/growth/jobs";
import { COMMAND_JOBS } from "@/server/modules/guide/command-jobs";
import { refreshMetricSnapshots, SNAPSHOT_REFRESH_MS } from "./snapshots";

/**
 * Background work of the bi module (plus the growth engine and the AI Command run advancer, which reacts to finished
 * agent tasks), run by the worker (src/worker/index.ts via src/worker/modules.ts). bi.metric_snapshots keeps the
 * Command Center's per-company metric snapshots warm in Redis (bi/snapshots.ts).
 */
export const BI_JOBS: ModuleJobs = {
  periodic: [...GROWTH_JOBS.periodic, ...COMMAND_JOBS.periodic, { name: "bi.metric_snapshots", everyMs: SNAPSHOT_REFRESH_MS, run: () => refreshMetricSnapshots() }],
  onEvent: [...GROWTH_JOBS.onEvent, ...COMMAND_JOBS.onEvent],
};
