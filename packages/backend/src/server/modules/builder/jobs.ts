import type { ModuleJobs } from "@/server/core/module-jobs";
import { db } from "@/server/core/db";
import { advanceActiveRuns, advanceRun } from "./engine";

/**
 * Background work of the AI Company Builder (register BUILDER_JOBS in src/worker/modules.ts):
 * - every 30 s: advance every running run (website imports, next steps, outputs of finished tasks);
 * - agent.task.completed / agent.task.failed: advance the run whose step that task belongs to right away.
 * Idempotent: every transition is a conditional update, so overlapping runs never repeat a step.
 */
export const BUILDER_JOBS: ModuleJobs = {
  periodic: [{ name: "builder.advance_runs", everyMs: 30_000, run: advanceActiveRuns }],
  onEvent: [
    {
      name: "builder.task_finished",
      types: ["agent.task.completed", "agent.task.failed"],
      async handle(event) {
        if (event.aggregateType !== "agent_task") return;
        const step = await db().builderStep.findFirst({ where: { agentTaskId: event.aggregateId }, select: { runId: true } });
        if (step) await advanceRun(step.runId);
      },
    },
  ],
};
