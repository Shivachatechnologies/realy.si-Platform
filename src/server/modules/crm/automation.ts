import type { Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { writeAudit } from "@/server/modules/audit/service";
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
    const owners = r.ownerIds.filter((id) => eligible.has(id));
    if (!owners.length) continue;
    // Lock the rule row so concurrent creations advance the round-robin cursor one at a time.
    const [locked] = await tx.$queryRaw<{ assigned_count: number }[]>`SELECT assigned_count FROM crm_assignment_rules WHERE id = ${r.id}::uuid FOR UPDATE`;
    const cursor = locked?.assigned_count ?? r.assignedCount;
    const ownerId = r.strategy === "ROUND_ROBIN" ? owners[cursor % owners.length]! : owners[0]!;
    await tx.crmAssignmentRule.update({ where: { id: r.id }, data: { assignedCount: { increment: 1 } } });
    return { ownerId, ruleId: r.id, ruleName: r.name };
  }
  return null;
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
      await tx.workTask.create({
        data: {
          organizationId: deal.organizationId,
          companyId: deal.companyId,
          title: (r.workTaskTitle || `${stage.name}: ${deal.name}`).slice(0, 200),
          description: `Deal: ${deal.name}`,
          assigneeId: deal.ownerId,
          dueDate: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z"),
          sourceType: "crm_deal",
          sourceId: deal.id,
          createdById: actorId(ctx, deal.organizationId),
        },
      });
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
