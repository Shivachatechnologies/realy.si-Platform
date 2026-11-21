import type { ModuleJobs } from "@/server/core/module-jobs";

/** Background work of the marketplace module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const MARKETPLACE_JOBS: ModuleJobs = { periodic: [], onEvent: [] };
