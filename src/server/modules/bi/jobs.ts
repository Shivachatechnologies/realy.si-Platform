import type { ModuleJobs } from "@/server/core/module-jobs";
import { GROWTH_JOBS } from "@/server/modules/growth/jobs";
import { COMMAND_JOBS } from "@/server/modules/guide/command-jobs";

/**
 * Background work of the bi module (plus the growth engine and the AI Command run advancer, which reacts to finished
 * agent tasks), run by the worker (src/worker/index.ts via src/worker/modules.ts).
 */
export const BI_JOBS: ModuleJobs = { periodic: [...GROWTH_JOBS.periodic, ...COMMAND_JOBS.periodic], onEvent: [...GROWTH_JOBS.onEvent, ...COMMAND_JOBS.onEvent] };
