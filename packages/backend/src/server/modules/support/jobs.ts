import type { ModuleJobs } from "@/server/core/module-jobs";
import { runSlaChecks } from "./sla-job";

/** Background work of the support module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const SUPPORT_JOBS: ModuleJobs = {
  periodic: [{ name: "support.sla-breach-detection", everyMs: 60_000, run: runSlaChecks }],
  onEvent: [],
};
