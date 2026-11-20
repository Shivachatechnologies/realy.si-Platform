import type { ModuleJobs } from "@/server/core/module-jobs";
import { GROWTH_JOBS } from "@/server/modules/growth/jobs";

/** Background work of the bi module (plus the growth engine), run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const BI_JOBS: ModuleJobs = { periodic: [...GROWTH_JOBS.periodic], onEvent: [...GROWTH_JOBS.onEvent] };
