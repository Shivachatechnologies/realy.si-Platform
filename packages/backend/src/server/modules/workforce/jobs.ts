import type { ModuleJobs } from "@/server/core/module-jobs";
import { handleCeoAnswer } from "./ceo-chat";
import { expireDelegationProposals } from "./delegation";
import { escalateStaleToFounder, handleTaskFailed, handleTaskFinished } from "./hierarchy";
import { handleTriggerEvent, runDueSchedules } from "./schedules";

/** Background work of the workforce module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const WORKFORCE_JOBS: ModuleJobs = {
  periodic: [
    { name: "workforce.ai-schedules", everyMs: 60_000, run: () => runDueSchedules() },
    // Escalation ladder: escalations an AI manager left unresolved for 24 h are raised to the founder.
    { name: "workforce.escalation-ladder", everyMs: 15 * 60_000, run: () => escalateStaleToFounder() },
    // Delegation proposals nobody decided within 72 h are closed.
    { name: "workforce.delegation-expiry", everyMs: 60 * 60_000, run: () => expireDelegationProposals() },
  ],
  onEvent: [
    // AI event triggers: a domain event starts a task for the AI employee (deduped per event id via ai_schedule_runs).
    { name: "workforce.ai-triggers", types: "*", handle: handleTriggerEvent },
    // Ask the CEO: completed answers are written into the conversation thread.
    { name: "workforce.ceo-answers", types: ["agent.task.completed"], handle: handleCeoAnswer },
    // Failed work is escalated to the AI employee's manager (report entry; the founder is notified at the top).
    { name: "workforce.escalate-failures", types: ["agent.task.failed"], handle: handleTaskFailed },
    // Delegated results roll up to the manager (and the founder at the top); escalation tasks resolve or climb.
    { name: "workforce.rollups", types: ["agent.task.completed", "agent.task.failed"], handle: handleTaskFinished },
  ],
};
