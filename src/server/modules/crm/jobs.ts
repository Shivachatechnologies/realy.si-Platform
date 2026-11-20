import type { ModuleJobs } from "@/server/core/module-jobs";
import { db, transaction } from "@/server/core/db";
import { notifyUsers } from "@/server/modules/notifications/service";

/**
 * Background work of the crm module, run by the worker (src/worker/index.ts via src/worker/modules.ts).
 * - Follow-up reminders: owners/assignees of open follow-ups due by the end of today (UTC) get one notification per
 *   company per day (remindedAt dedupes across runs and processes).
 * - Stale deals: open deals that sat in their stage longer than the pipeline's staleDays are flagged (staleSince) and
 *   their owner is notified once.
 */

const HOUR = 3_600_000;
const BATCH = 2000;

const startOfUtcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function remindFollowUps(now = new Date()): Promise<number> {
  const dayStart = startOfUtcDay(now);
  const dayEnd = new Date(dayStart.getTime() + 24 * HOUR - 1);
  const notYetToday = { OR: [{ remindedAt: null }, { remindedAt: { lt: dayStart } }] };
  const [leadDue, crmDue] = await Promise.all([
    db().leadFollowUp.findMany({
      where: { completedAt: null, dueAt: { lte: dayEnd }, lead: { archivedAt: null, ownerId: { not: null } }, ...notYetToday },
      select: { id: true, organizationId: true, companyId: true, dueAt: true, lead: { select: { ownerId: true } } },
      take: BATCH,
    }),
    db().crmFollowUp.findMany({
      where: { completedAt: null, dueAt: { lte: dayEnd }, assigneeId: { not: null }, ...notYetToday },
      select: { id: true, organizationId: true, companyId: true, dueAt: true, assigneeId: true },
      take: BATCH,
    }),
  ]);
  type Group = { organizationId: string; companyId: string; userId: string; due: number; overdue: number; leadIds: string[]; crmIds: string[] };
  const groups = new Map<string, Group>();
  const add = (organizationId: string, companyId: string, userId: string, dueAt: Date, kind: "lead" | "crm", id: string) => {
    const k = `${companyId}:${userId}`;
    const g = groups.get(k) ?? { organizationId, companyId, userId, due: 0, overdue: 0, leadIds: [], crmIds: [] };
    if (dueAt < dayStart) g.overdue++;
    else g.due++;
    (kind === "lead" ? g.leadIds : g.crmIds).push(id);
    groups.set(k, g);
  };
  for (const f of leadDue) add(f.organizationId, f.companyId, f.lead.ownerId!, f.dueAt, "lead", f.id);
  for (const f of crmDue) add(f.organizationId, f.companyId, f.assigneeId!, f.dueAt, "crm", f.id);
  let sent = 0;
  for (const g of groups.values()) {
    await transaction(async (tx) => {
      // Claim the rows first so a concurrent run cannot notify twice.
      const a = g.leadIds.length ? (await tx.leadFollowUp.updateMany({ where: { id: { in: g.leadIds }, ...notYetToday }, data: { remindedAt: now } })).count : 0;
      const b = g.crmIds.length ? (await tx.crmFollowUp.updateMany({ where: { id: { in: g.crmIds }, ...notYetToday }, data: { remindedAt: now } })).count : 0;
      if (!a && !b) return;
      const title = g.overdue ? `${g.due + g.overdue} (${g.overdue} overdue)` : String(g.due);
      sent += await notifyUsers(tx, g.organizationId, [g.userId], g.overdue ? "crm.follow_ups_overdue" : "crm.follow_ups_due", { companyId: g.companyId, title, href: "/crm/calendar" });
    });
  }
  return sent;
}

export async function markStaleDeals(now = new Date()): Promise<number> {
  const pipelines = await db().crmPipeline.findMany({ where: { archivedAt: null }, select: { id: true, staleDays: true }, take: 10_000 });
  let flagged = 0;
  for (const p of pipelines) {
    const cutoff = new Date(now.getTime() - p.staleDays * 24 * HOUR);
    const deals = await db().crmDeal.findMany({
      where: { pipelineId: p.id, status: "OPEN", archivedAt: null, staleSince: null, stageEnteredAt: { lt: cutoff } },
      select: { id: true, organizationId: true, companyId: true, name: true, ownerId: true },
      take: BATCH,
    });
    for (const d of deals) {
      await transaction(async (tx) => {
        const { count } = await tx.crmDeal.updateMany({ where: { id: d.id, staleSince: null, status: "OPEN" }, data: { staleSince: now } });
        if (!count) return;
        flagged++;
        await notifyUsers(tx, d.organizationId, [d.ownerId], "crm.deal_stale", { companyId: d.companyId, title: d.name, href: `/crm/deals/${d.id}` });
      });
    }
  }
  return flagged;
}

export const CRM_JOBS: ModuleJobs = {
  periodic: [
    { name: "crm.follow_up_reminders", everyMs: HOUR, run: () => remindFollowUps() },
    { name: "crm.stale_deals", everyMs: 6 * HOUR, run: () => markStaleDeals() },
  ],
  onEvent: [],
};
