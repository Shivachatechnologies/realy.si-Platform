import type { ModuleJobs } from "@/server/core/module-jobs";
import { db, transaction } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { syncChecklistStatus } from "./onboarding";
import { syncFilledPlans } from "./planning";

/**
 * Background work of the hr module, run by the worker (src/worker/index.ts via src/worker/modules.ts).
 * - task.completed: when a WorkTask created for an onboarding/offboarding step is completed in the Work module, the step
 *   is checked and the checklist completes once every step is done.
 * - hr.checklist-sync (hourly): the same reconciliation for tasks completed without an event (idempotent).
 * - hr.headcount-filled (hourly): workforce-plan roles whose job hired all openings become FILLED.
 */

async function syncByTask(companyId: string, workTaskId: string) {
  const item = await db().hrChecklistItem.findFirst({ where: { companyId, workTaskId }, select: { id: true, checklistId: true, completedAt: true } });
  if (!item) return;
  await transaction(async (tx) => {
    const task = await tx.workTask.findFirst({ where: { id: workTaskId, companyId }, select: { status: true, completedAt: true } });
    if (task?.status === "DONE" && !item.completedAt) await tx.hrChecklistItem.update({ where: { id: item.id }, data: { completedAt: task.completedAt ?? new Date() } });
    await syncChecklistStatus(tx, companyId, item.checklistId);
  });
}

export const HR_JOBS: ModuleJobs = {
  periodic: [
    {
      name: "hr.checklist-sync",
      everyMs: 60 * 60_000,
      async run() {
        const open = await db().hrChecklist.findMany({ where: { status: "IN_PROGRESS" }, select: { id: true, companyId: true }, take: 500 });
        for (const c of open) await transaction((tx) => syncChecklistStatus(tx, c.companyId, c.id));
        return open.length;
      },
    },
    { name: "hr.headcount-filled", everyMs: 60 * 60_000, run: () => syncFilledPlans() },
  ],
  onEvent: [
    {
      name: "hr.onboarding-task-sync",
      types: ["task.completed"],
      async handle(event) {
        const id = (event.payload as { entityId?: string } | null)?.entityId ?? event.aggregateId;
        if (!event.companyId || !id) return;
        await syncByTask(event.companyId, id).catch((err) => logger.warn({ err, eventId: event.id }, "hr onboarding sync failed"));
      },
    },
  ],
};
