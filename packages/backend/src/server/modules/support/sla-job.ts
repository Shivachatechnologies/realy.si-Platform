import type { SupportPriority } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import { systemContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { OPEN_STATUSES, supportAgents } from "./common";
import { escalateBreaches } from "./automation";

const RAISE: Record<SupportPriority, SupportPriority> = { LOW: "NORMAL", NORMAL: "HIGH", HIGH: "URGENT", URGENT: "URGENT" };

/**
 * SLA tracking: marks first-response and resolution breaches on open tickets, applies the company's escalation rules
 * (raise priority, reassign, notify managers) and notifies the assignee. Each breach is handled once.
 */
export async function runSlaChecks(): Promise<number> {
  const now = new Date();
  const due = await db().supportTicket.findMany({
    where: {
      status: { in: [...OPEN_STATUSES] },
      OR: [
        { firstRespondedAt: null, firstResponseBreachedAt: null, firstResponseDueAt: { lt: now } },
        { resolutionBreachedAt: null, resolutionDueAt: { lt: now } },
      ],
    },
    take: 200,
    orderBy: { resolutionDueAt: "asc" },
  });
  let handled = 0;
  const breached: Parameters<typeof escalateBreaches>[0] = [];
  for (const t of due) {
    try {
      await transaction(async (tx) => {
        const fresh = await tx.supportTicket.findUnique({ where: { id: t.id } });
        if (!fresh || !(OPEN_STATUSES as readonly string[]).includes(fresh.status)) return;
        const firstBreach = !fresh.firstRespondedAt && !fresh.firstResponseBreachedAt && fresh.firstResponseDueAt && fresh.firstResponseDueAt < now;
        const resolutionBreach = !fresh.resolutionBreachedAt && fresh.resolutionDueAt && fresh.resolutionDueAt < now;
        if (!firstBreach && !resolutionBreach) return;
        const ctx = systemContext();
        const triggers = [...(firstBreach ? ["FIRST_RESPONSE_BREACH" as const] : []), ...(resolutionBreach ? ["RESOLUTION_BREACH" as const] : [])];
        const rules = await tx.supportEscalationRule.findMany({ where: { companyId: fresh.companyId, active: true, trigger: { in: triggers } }, orderBy: { createdAt: "asc" } });
        let priority = fresh.priority;
        let assigneeId = fresh.assigneeId;
        let notifyManagers = false;
        if (rules.some((r) => r.raisePriority)) priority = RAISE[priority];
        const reassign = rules.find((r) => r.reassignToId)?.reassignToId;
        if (reassign) {
          const chain = await companyChain(tx, fresh.organizationId, fresh.companyId);
          if ((await supportAgents(tx, fresh.organizationId, chain, [reassign])).length) assigneeId = reassign;
        }
        if (rules.some((r) => r.notifyManagers)) notifyManagers = true;
        const escalated = rules.length > 0;
        await tx.supportTicket.update({
          where: { id: fresh.id },
          data: {
            ...(firstBreach ? { firstResponseBreachedAt: now } : {}),
            ...(resolutionBreach ? { resolutionBreachedAt: now } : {}),
            priority,
            assigneeId,
            ...(escalated ? { escalationLevel: { increment: 1 }, escalatedAt: now } : {}),
          },
        });
        const data = { number: fresh.number, subject: fresh.subject, status: fresh.status, priority, previousPriority: fresh.priority, assigneeId, slaBreach: triggers.join(","), escalated };
        await emitDomainEvent(tx, ctx, "ticket.updated", { organizationId: fresh.organizationId, companyId: fresh.companyId, entityType: "ticket", entityId: fresh.id, data });
        await writeAudit(tx, ctx, { category: "TENANT", organizationId: fresh.organizationId, action: "ticket.sla_breached", resourceType: "ticket", resourceId: fresh.id, newValue: data });
        const payload = { companyId: fresh.companyId, title: `#${fresh.number} ${fresh.subject}`.slice(0, 120), href: `/support/tickets/${fresh.id}` };
        const managers = notifyManagers || !assigneeId ? await usersWithPermission(tx, fresh.organizationId, fresh.companyId, "support.manage") : [];
        await notifyUsers(tx, fresh.organizationId, [assigneeId, ...managers], escalated ? "support.escalated" : "support.sla_breached", payload);
        breached.push({ id: fresh.id, organizationId: fresh.organizationId, companyId: fresh.companyId, number: fresh.number, subject: fresh.subject, priority, triggers });
        handled++;
      });
    } catch (err) {
      logger.warn({ err, ticketId: t.id }, "SLA check failed");
    }
  }
  if (breached.length) await escalateBreaches(breached);
  return handled;
}
