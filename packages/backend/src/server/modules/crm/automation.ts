import type { Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers } from "@/server/modules/notifications/service";
import type { ScopeChain } from "@/server/modules/rbac/scope";
import { actorId, eligibleOwnerIds } from "./common";

/**
 * Sales automation applied inside the caller's transaction: lead auto-assignment rules (on lead creation) and
 * stage-entry rules (when a deal enters a stage). Rule CRUD lives in ./config.ts.
 */

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * First active rule (by position) whose source/territory match picks an owner: round-robin over its eligible owners
 * (cursor = assignedCount) or always the first eligible one. Returns null when no rule applies.
 */
export async function pickAutoOwner(tx: Tx, organizationId: string, companyId: string, chain: ScopeChain, lead: { source: string | null; territory: string | null }) {
  const rules = await tx.crmAssignmentRule.findMany({ where: { companyId, active: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  for (const r of rules) {
    if (r.matchSource && !same(r.matchSource, lead.source)) continue;
    if (r.matchTerritory && !same(r.matchTerritory, lead.territory)) continue;
    const eligible = new Set(await eligibleOwnerIds(tx, organizationId, chain, r.ownerIds));
    const atCapacity = await unavailableOwners(tx, companyId, r.ownerIds);
    const owners = r.ownerIds.filter((id) => eligible.has(id) && !atCapacity.has(id));
    if (!owners.length) continue;
    // Lock the rule row so concurrent creations advance the round-robin cursor one at a time.
    const [locked] = await tx.$queryRaw<{ assigned_count: number }[]>`SELECT assigned_count FROM crm_assignment_rules WHERE id = ${r.id}::uuid FOR UPDATE`;
    const cursor = locked?.assigned_count ?? r.assignedCount;
    const ownerId = r.strategy === "ROUND_ROBIN" ? owners[cursor % owners.length]! : owners[0]!;
    await tx.crmAssignmentRule.update({ where: { id: r.id }, data: { assignedCount: { increment: 1 } } });
    return { ownerId, ruleId: r.id, ruleName: r.name, followUpDays: r.followUpDays, followUpNote: r.followUpNote };
  }
  return null;
}

/** Owners excluded from auto-assignment: marked unavailable, or at their open-lead capacity (team settings). */
async function unavailableOwners(tx: Tx, companyId: string, ownerIds: string[]) {
  const reps = await tx.crmSalesRep.findMany({ where: { companyId, ownerId: { in: ownerIds } }, select: { ownerId: true, available: true, maxOpenLeads: true } });
  const out = new Set(reps.filter((r) => !r.available).map((r) => r.ownerId));
  const capped = reps.filter((r) => r.available && r.maxOpenLeads != null);
  if (capped.length) {
    const counts = await tx.lead.groupBy({ by: ["ownerId"], where: { companyId, ownerId: { in: capped.map((r) => r.ownerId) }, archivedAt: null, convertedAt: null }, _count: { _all: true } });
    const n = new Map(counts.map((c) => [c.ownerId, c._count._all]));
    for (const r of capped) if ((n.get(r.ownerId) ?? 0) >= r.maxOpenLeads!) out.add(r.ownerId);
  }
  return out;
}

/**
 * The single lead-intake workflow: lead.created → assignment rule picks an owner → the rule's follow-up is scheduled →
 * the owner is notified (and lead.assigned emitted). Runs inline from createLead and, for leads created elsewhere
 * (e.g. marketing forms) without an owner, from the lead.created event handler in ./jobs.ts. Returns the owner or null.
 */
export async function runLeadIntake(
  tx: Tx,
  ctx: RequestContext,
  chain: ScopeChain,
  lead: { id: string; organizationId: string; companyId: string; name: string; source: string | null; territory: string | null; ownerId: string | null },
  opts: { notify: boolean; emit: boolean },
) {
  if (lead.ownerId) return null;
  const auto = await pickAutoOwner(tx, lead.organizationId, lead.companyId, chain, lead);
  if (!auto) return null;
  // Only assign if still unowned (the event handler may race a manual assignment).
  const { count } = await tx.lead.updateMany({ where: { id: lead.id, ownerId: null }, data: { ownerId: auto.ownerId } });
  if (!count) return null;
  if (auto.followUpDays != null) {
    await tx.leadFollowUp.create({
      data: {
        organizationId: lead.organizationId,
        companyId: lead.companyId,
        leadId: lead.id,
        dueAt: new Date(Date.now() + auto.followUpDays * 86_400_000),
        note: (auto.followUpNote || `First contact: ${lead.name}`).slice(0, 1000),
        createdById: actorId(ctx, lead.organizationId),
      },
    });
  }
  await writeAudit(tx, ctx, { category: "TENANT", organizationId: lead.organizationId, action: "lead.auto_assigned", resourceType: "lead", resourceId: lead.id, newValue: { ownerId: auto.ownerId, rule: auto.ruleId, followUpDays: auto.followUpDays } });
  if (opts.emit) {
    await emitDomainEvent(tx, ctx, "lead.assigned", { organizationId: lead.organizationId, companyId: lead.companyId, entityType: "lead", entityId: lead.id, data: { name: lead.name, ownerId: auto.ownerId, previousOwnerId: null, rule: auto.ruleName, source: lead.source } });
  }
  if (opts.notify && auto.ownerId !== ctx.actor.id) {
    await notifyUsers(tx, lead.organizationId, [auto.ownerId], "crm.lead_assigned", { companyId: lead.companyId, title: lead.name, href: `/crm/${lead.id}` });
  }
  return auto;
}

/** Run the active rules of `stageId` for a deal that just entered it. */
export async function applyStageRules(
  tx: Tx,
  ctx: RequestContext,
  deal: { id: string; organizationId: string; companyId: string; name: string; ownerId: string | null },
  stage: { id: string; name: string },
) {
  const rules = await tx.crmStageRule.findMany({ where: { stageId: stage.id, companyId: deal.companyId, active: true } });
  if (!rules.length) return 0;
  const href = `/crm/deals/${deal.id}`;
  for (const r of rules) {
    if (r.createFollowUp) {
      const dueAt = new Date(Date.now() + r.followUpDays * 86_400_000);
      await tx.crmFollowUp.create({
        data: {
          organizationId: deal.organizationId,
          companyId: deal.companyId,
          dealId: deal.id,
          assigneeId: deal.ownerId,
          dueAt,
          note: (r.followUpNote || `${stage.name}: ${deal.name}`).slice(0, 1000),
          createdById: actorId(ctx, deal.organizationId),
        },
      });
    }
    if (r.createWorkTask) {
      // "Create sales task" action: a WorkTask linked to the deal (shown in the deal's Tasks panel and "My sales tasks").
      const due = new Date(`${new Date(Date.now() + r.workTaskDueDays * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`);
      const task = await tx.workTask.create({
        data: {
          organizationId: deal.organizationId,
          companyId: deal.companyId,
          title: (r.workTaskTitle || `${stage.name}: ${deal.name}`).slice(0, 200),
          description: `Deal: ${deal.name}`,
          assigneeId: deal.ownerId,
          priority: r.workTaskPriority,
          dueDate: due,
          labels: ["sales"],
          sourceType: "crm_deal",
          sourceId: deal.id,
          createdById: actorId(ctx, deal.organizationId),
        },
      });
      await emitDomainEvent(tx, ctx, "task.created", {
        organizationId: deal.organizationId,
        companyId: deal.companyId,
        entityType: "work_task",
        entityId: task.id,
        data: { title: task.title, projectId: null, assigneeId: task.assigneeId, dueDate: task.dueDate, priority: task.priority, status: task.status, sourceType: "crm_deal", sourceId: deal.id },
      });
      if (task.assigneeId && task.assigneeId !== ctx.actor.id) {
        await notifyUsers(tx, deal.organizationId, [task.assigneeId], "crm.sales_task_assigned", { companyId: deal.companyId, title: task.title, href });
      }
    }
    if (r.notifyOwner && deal.ownerId && deal.ownerId !== ctx.actor.id) {
      await notifyUsers(tx, deal.organizationId, [deal.ownerId], "crm.deal_stage_entered", { companyId: deal.companyId, title: `${deal.name} → ${stage.name}`, href });
    }
  }
  await writeAudit(tx, ctx, {
    category: "TENANT",
    organizationId: deal.organizationId,
    action: "crm.stage_rules.applied",
    resourceType: "crm_deal",
    resourceId: deal.id,
    newValue: { stageId: stage.id, rules: rules.map((r) => r.id) },
  });
  return rules.length;
}
