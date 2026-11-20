import type { ModuleJobs } from "@/server/core/module-jobs";
import { logger } from "@/server/core/logger";
import { advanceRunForTask } from "./command-run";

/**
 * AI Command background work: when an agent task finishes, the command run it belongs to delegates its next steps
 * (e.g. the departments after research, the review after the departments). Idempotent: steps are claimed with a
 * conditional update, so at-least-once delivery and the workspace's own polling never double-delegate.
 */
export const COMMAND_JOBS: ModuleJobs = {
  periodic: [],
  onEvent: [
    {
      name: "guide.command.advance_run",
      types: ["agent.task.completed", "agent.task.failed"],
      async handle(event) {
        if (event.aggregateType !== "agent_task" || !event.aggregateId || !event.organizationId || !event.companyId) return;
        try {
          await advanceRunForTask(event.organizationId, event.companyId, event.aggregateId);
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err), taskId: event.aggregateId }, "command run advance failed");
        }
      },
    },
  ],
};
