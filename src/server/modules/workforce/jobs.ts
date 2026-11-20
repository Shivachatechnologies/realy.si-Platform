import type { ModuleJobs } from "@/server/core/module-jobs";
import { handleTriggerEvent, runDueSchedules } from "./schedules";

/** Background work of the workforce module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const WORKFORCE_JOBS: ModuleJobs = {
  periodic: [{ name: "workforce.ai-schedules", everyMs: 60_000, run: () => runDueSchedules() }],
  // AI event triggers: a domain event starts a task for the AI employee (deduped per event id via ai_schedule_runs).
  onEvent: [{ name: "workforce.ai-triggers", types: "*", handle: handleTriggerEvent }],
};
