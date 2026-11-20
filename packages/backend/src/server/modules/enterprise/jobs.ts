import type { ModuleJobs } from "@/server/core/module-jobs";
import { applyRetention, processScheduledDeletions } from "./data";

/** Background work of the enterprise module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const ENTERPRISE_JOBS: ModuleJobs = {
  periodic: [
    {
      name: "enterprise.scheduled_deletions",
      everyMs: 60 * 60_000,
      run: processScheduledDeletions,
    },
    {
      name: "enterprise.retention",
      everyMs: 24 * 60 * 60_000,
      run: applyRetention,
    },
  ],
  onEvent: [],
};
