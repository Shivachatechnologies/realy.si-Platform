import type { ModuleJobs } from "@/server/core/module-jobs";
import { db, transaction } from "@/server/core/db";
import { systemContext } from "@/server/core/context";
import { openDueChecklistRuns } from "./operations";
import { today } from "./shared";
import { spawnNextOccurrence } from "./tasks";

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
  ],
  onEvent: [],
};
