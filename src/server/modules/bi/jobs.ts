import type { ModuleJobs } from "@/server/core/module-jobs";

/** Background work of the bi module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const BI_JOBS: ModuleJobs = { periodic: [], onEvent: [] };
