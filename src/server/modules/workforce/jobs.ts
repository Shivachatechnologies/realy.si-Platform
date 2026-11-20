import type { ModuleJobs } from "@/server/core/module-jobs";
import { handleCeoAnswer } from "./ceo-chat";
import { handleTaskFailed } from "./hierarchy";
import { handleTriggerEvent, runDueSchedules } from "./schedules";

/** Background work of the workforce module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const WORKFORCE_JOBS: ModuleJobs = {
  periodic: [{ name: "workforce.ai-schedules", everyMs: 60_000, run: () => runDueSchedules() }],
  onEvent: [
    // AI event triggers: a domain event starts a task for the AI employee (deduped per event id via ai_schedule_runs).
    { name: "workforce.ai-triggers", types: "*", handle: handleTriggerEvent },
    // Ask the CEO: completed answers are written into the conversation thread.
    { name: "workforce.ceo-answers", types: ["agent.task.completed"], handle: handleCeoAnswer },
    // Failed work is escalated to the AI employee's manager (report entry; the founder is notified at the top).
    { name: "workforce.escalate-failures", types: ["agent.task.failed"], handle: handleTaskFailed },
  ],
};
