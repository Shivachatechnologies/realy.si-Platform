import type { ModuleJobs } from "@/server/core/module-jobs";
import { db, transaction } from "@/server/core/db";
import { systemContext } from "@/server/core/context";
import { openDueChecklistRuns } from "./operations";
import { advanceProductPlans } from "./product-plan";
import { today } from "./shared";
import { spawnNextOccurrence } from "./tasks";
import { runDeadlineRiskAlerts, runWeeklyProjectReports } from "./delivery";
import { runExecutionTracking } from "./execution";

const QUARTER_HOUR = 15 * 60_000;

/** Create the next occurrence of recurring tasks whose current occurrence is due (idempotent via recurrenceSpawnedAt). */
export async function spawnDueRecurrences(now = new Date()) {
  const due = await db().workTask.findMany({
    where: { recurrence: { not: null }, recurrenceSpawnedAt: null, archivedAt: null, status: { not: "CANCELLED" }, dueDate: { lte: today(now) } },
    select: { id: true },
    take: 500,
  });
  const ctx = systemContext();
  let created = 0;
  for (const t of due) {
    const next = await transaction((tx) => spawnNextOccurrence(tx, ctx, t.id));
    if (next) created++;
  }
  return created;
}

/** Background work of the work module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const WORK_JOBS: ModuleJobs = {
  periodic: [
    { name: "work.recurring-tasks", everyMs: QUARTER_HOUR, run: () => spawnDueRecurrences() },
    { name: "work.checklist-runs", everyMs: QUARTER_HOUR, run: () => openDueChecklistRuns() },
    { name: "work.product-plans", everyMs: 60_000, run: () => advanceProductPlans() },
    // Mondays: weekly AI status report per active project by the hired AI project manager (once per project per week).
    { name: "work.weekly-status-reports", everyMs: 60 * 60_000, run: () => runWeeklyProjectReports() },
    // High-severity deadline risks: the project owner is notified at most once a day per project.
    { name: "work.deadline-risk-alerts", everyMs: 6 * 60 * 60_000, run: () => runDeadlineRiskAlerts() },
    // Objective execution tracking: close finished milestones/projects, alert owners about critical blockers (daily).
    { name: "work.execution-tracking", everyMs: 60 * 60_000, run: () => runExecutionTracking() },
  ],
  onEvent: [],
};
