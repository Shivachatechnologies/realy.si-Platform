import type { ModuleJobs } from "@/server/core/module-jobs";
import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { isOrganizationSuspended } from "@/server/core/platform-controls";
import type { OutboxEvent } from "@/server/modules/events/relay";
import { deliverReport } from "./deliver";
import { buildReport, finishSummary } from "./service";
import { SUMMARY_SUBJECT } from "./summary";
import { dueSlots } from "./time";

const BATCH = 500;

/** Every minute: build and send the briefings whose local time has come (each slot once per subscription). */
export async function dispatchDueBriefings(now = new Date()): Promise<number> {
  let done = 0;
  let cursor: string | undefined;
  for (;;) {
    const subs = await db().briefingSubscription.findMany({ where: { enabled: true }, orderBy: { id: "asc" }, take: BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!subs.length) break;
    cursor = subs[subs.length - 1]!.id;
    for (const sub of subs) {
      for (const due of dueSlots(sub, now, sub.timezone)) {
        const field = due.kind === "MORNING" ? "lastMorningSlot" : due.kind === "EVENING" ? "lastEveningSlot" : "lastWeeklySlot";
        // Claim the slot first so concurrent workers never build it twice.
        const claimed = await db().briefingSubscription.updateMany({ where: { id: sub.id, OR: [{ [field]: null }, { [field]: { not: due.slot } }] }, data: { [field]: due.slot } });
        if (!claimed.count) continue;
        if (await isOrganizationSuspended(sub.organizationId)) continue;
        try {
          await buildReport(sub, due.kind, `${sub.id}:${due.kind}:${due.slot}`, { now });
          done++;
        } catch (err) {
          logger.error({ subscriptionId: sub.id, kind: due.kind, err: err instanceof Error ? err.message : String(err) }, "briefing build failed");
        }
      }
    }
    if (subs.length < BATCH) break;
  }
  return done;
}

/** Reports whose AI summary did not arrive in time are delivered without it. */
export async function deliverOverdue(now = new Date()): Promise<number> {
  const rows = await db().briefingReport.findMany({ where: { status: "SUMMARIZING", deliveredAt: null, deliverAfter: { lt: now } }, select: { id: true }, take: 200 });
  for (const r of rows) await finishSummary(r.id, { output: null, status: "timeout" }).catch((err) => logger.error({ reportId: r.id, err: err instanceof Error ? err.message : String(err) }, "briefing delivery failed"));
  // Reports that never got a summary task and were not delivered (e.g. a crash between steps).
  const stuck = await db().briefingReport.findMany({ where: { status: "SUMMARIZING", deliveredAt: null, deliverAfter: null, createdAt: { lt: new Date(now.getTime() - 5 * 60_000) } }, select: { id: true }, take: 200 });
  for (const r of stuck) await deliverReport(r.id).catch(() => undefined);
  return rows.length + stuck.length;
}

/** Housekeeping: drop long-expired decision tokens and old inbound message records. */
export async function cleanup(now = new Date()): Promise<number> {
  const [tokens, inbound] = await Promise.all([
    db().briefingActionToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } }),
    db().briefingInboundMessage.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } } }),
  ]);
  return tokens.count + inbound.count;
}

/** The AI summary task finished: keep its text (only if every number is from the facts) and deliver. */
export async function handleSummaryTask(event: OutboxEvent): Promise<void> {
  if (!event.organizationId || !event.companyId) return;
  const data = ((event.payload ?? {}) as { data?: { subjectType?: string; subjectId?: string } }).data ?? {};
  if (data.subjectType !== SUMMARY_SUBJECT || !data.subjectId) return;
  const report = await db().briefingReport.findFirst({ where: { id: data.subjectId, organizationId: event.organizationId, companyId: event.companyId, summaryTaskId: event.aggregateId, deliveredAt: null }, select: { id: true } });
  if (!report) return;
  const task = await db().agentTask.findFirst({ where: { id: event.aggregateId, companyId: event.companyId }, select: { status: true, output: true } });
  await finishSummary(report.id, task?.status === "COMPLETED" ? { output: task.output, status: "ready" } : { output: null, status: "failed" });
}

/** Background work of the briefing module (register in src/worker/modules.ts). */
export const BRIEFING_JOBS: ModuleJobs = {
  periodic: [
    { name: "briefing.dispatch", everyMs: 60_000, run: () => dispatchDueBriefings() },
    { name: "briefing.deliver-overdue", everyMs: 60_000, run: () => deliverOverdue() },
    { name: "briefing.cleanup", everyMs: 24 * 3_600_000, run: () => cleanup() },
  ],
  onEvent: [{ name: "briefing.summaries", types: ["agent.task.completed", "agent.task.failed"], handle: handleSummaryTask }],
};
