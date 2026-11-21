import type { ModuleJobs } from "@/server/core/module-jobs";
import { logger } from "@/server/core/logger";
import { fireSchedules, handleWorkflowEvent, processDueRuns } from "./engine";

/** Background work of the automation module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const AUTOMATION_JOBS: ModuleJobs = {
  periodic: [
    // Resumes delays, polls AI tasks, retries failed steps with backoff and recovers stale claims.
    { name: "automation.process_runs", everyMs: 15_000, run: () => processDueRuns() },
    { name: "automation.schedules", everyMs: 60_000, run: () => fireSchedules() },
  ],
  onEvent: [
    {
      name: "automation.workflow_triggers",
      types: "*",
      async handle(event) {
        // Never throw: the event job is shared with other modules' handlers and would be retried for all of them.
        await handleWorkflowEvent(event).catch((err) => logger.error({ err: err instanceof Error ? err.message : err, eventId: event.id }, "workflow trigger failed"));
      },
    },
  ],
};
