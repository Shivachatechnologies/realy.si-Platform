import { z } from "zod";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { authorize, isUuid, PRIORITIES, supportAgents, uuid } from "./common";

// ─── Settings ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const settingsInput = z.object({
  helpCenterEnabled: z.boolean().optional(),
  supportFormEnabled: z.boolean().optional(),
  aiTriageEnabled: z.boolean().optional(),
  emailChannelEnabled: z.boolean().optional(),
  supportEmail: z.string().trim().toLowerCase().email().max(254).nullable().optional().or(z.literal("").transform(() => null)),
  setupStep: z.enum(["channels", "promises", "articles", "done"]).optional(),
});

export async function ensureSettings(client: Tx | Db, organizationId: string, companyId: string) {
  return client.supportSettings.upsert({ where: { companyId }, create: { companyId, organizationId }, update: {} });
}

export async function getSettings(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  return ensureSettings(db(), organizationId, companyId);
}

export async function updateSettings(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof settingsInput>) {
  const input = settingsInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    await ensureSettings(tx, organizationId, companyId);
    const s = await tx.supportSettings.update({ where: { companyId }, data: { ...input, ...(input.setupStep === "done" ? { setupCompletedAt: new Date() } : {}) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "support.settings.updated", resourceType: "support_settings", resourceId: companyId, newValue: input });
    return s;
  });
}

// ─── Categories ───────────────────────────────────────────────────────────────────────────────────────────────────

export const categoryInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  keywords: z.array(z.string().trim().toLowerCase().min(2).max(60)).max(50).default([]),
  defaultPriority: z.enum(PRIORITIES).nullable().optional(),
});

export async function listCategories(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  return db().supportCategory.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, include: { _count: { select: { tickets: true } } } });
}

export async function saveCategory(ctx: RequestContext, organizationId: string, companyId: string, id: string | null, raw: z.input<typeof categoryInput>) {
  const input = categoryInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    const clash = await tx.supportCategory.findFirst({ where: { companyId, name: { equals: input.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) }, select: { id: true, archivedAt: true } });
    if (clash && !clash.archivedAt) throw conflict("A category with this name exists", { reason: "support_name_exists" });
    if (clash) await tx.supportCategory.update({ where: { id: clash.id }, data: { name: `${input.name} (archived ${clash.id.slice(0, 6)})` } });
    const data = { name: input.name, description: input.description || null, keywords: [...new Set(input.keywords)], defaultPriority: input.defaultPriority ?? null };
    if (id) {
      if (!isUuid(id) || !(await tx.supportCategory.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("Category");
      return tx.supportCategory.update({ where: { id }, data });
    }
    const c = await tx.supportCategory.create({ data: { ...data, organizationId, companyId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "support.category.created", resourceType: "support_category", resourceId: c.id, newValue: { name: c.name } });
    return c;
  });
}

export async function archiveCategory(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (!isUuid(id) || !(await tx.supportCategory.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("Category");
    await tx.supportCategory.update({ where: { id }, data: { archivedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "support.category.archived", resourceType: "support_category", resourceId: id });
    return { ok: true };
  });
}

// ─── SLA policies ─────────────────────────────────────────────────────────────────────────────────────────────────

const target = z.object({ firstResponseMinutes: z.number().int().min(1).max(60 * 24 * 60), resolutionMinutes: z.number().int().min(1).max(60 * 24 * 120) });
export const slaPolicyInput = z.object({
  name: z.string().trim().min(1).max(100),
  isDefault: z.boolean().default(false),
  businessHoursOnly: z.boolean().default(false),
  businessStartHour: z.number().int().min(0).max(23).default(9),
  businessEndHour: z.number().int().min(1).max(24).default(17),
  businessDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5]),
  targets: z.object({ LOW: target, NORMAL: target, HIGH: target, URGENT: target }),
});

export async function listSlaPolicies(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  return db().supportSlaPolicy.findMany({ where: { organizationId, companyId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], include: { targets: true } });
}

export async function saveSlaPolicy(ctx: RequestContext, organizationId: string, companyId: string, id: string | null, raw: z.input<typeof slaPolicyInput>) {
  const input = slaPolicyInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (await tx.supportSlaPolicy.findFirst({ where: { companyId, name: { equals: input.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) {
      throw conflict("A policy with this name exists", { reason: "support_name_exists" });
    }
    const first = !(await tx.supportSlaPolicy.count({ where: { companyId } }));
    const isDefault = input.isDefault || (first && !id);
    if (isDefault) await tx.supportSlaPolicy.updateMany({ where: { companyId }, data: { isDefault: false } });
    const data = {
      name: input.name,
      isDefault,
      businessHoursOnly: input.businessHoursOnly,
      businessStartHour: input.businessStartHour,
      businessEndHour: Math.max(input.businessEndHour, input.businessStartHour + 1),
      businessDays: [...new Set(input.businessDays)].sort(),
    };
    let policyId = id;
    if (id) {
      if (!isUuid(id) || !(await tx.supportSlaPolicy.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("SLA policy");
      await tx.supportSlaPolicy.update({ where: { id }, data });
      await tx.supportSlaTarget.deleteMany({ where: { policyId: id } });
    } else {
      policyId = (await tx.supportSlaPolicy.create({ data: { ...data, organizationId, companyId } })).id;
    }
    await tx.supportSlaTarget.createMany({ data: PRIORITIES.map((priority) => ({ policyId: policyId!, companyId, priority, ...input.targets[priority] })) });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: id ? "support.sla.updated" : "support.sla.created", resourceType: "support_sla_policy", resourceId: policyId, newValue: { name: input.name, targets: input.targets } });
    return tx.supportSlaPolicy.findUniqueOrThrow({ where: { id: policyId! }, include: { targets: true } });
  });
}

export async function deleteSlaPolicy(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (!isUuid(id) || !(await tx.supportSlaPolicy.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("SLA policy");
    await tx.supportTicket.updateMany({ where: { companyId, slaPolicyId: id }, data: { slaPolicyId: null } });
    await tx.supportSlaPolicy.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "support.sla.deleted", resourceType: "support_sla_policy", resourceId: id });
    return { ok: true };
  });
}

// ─── Assignment and escalation rules ──────────────────────────────────────────────────────────────────────────────

export const assignmentRuleInput = z.object({
  name: z.string().trim().min(1).max(100),
  strategy: z.enum(["ROUND_ROBIN", "BY_CATEGORY"]),
  categoryId: uuid.nullable().optional(),
  assigneeIds: z.array(uuid).min(1).max(50),
  position: z.number().int().min(0).max(1000).default(0),
  active: z.boolean().default(true),
});

export async function listAssignmentRules(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  return db().supportAssignmentRule.findMany({ where: { organizationId, companyId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
}

export async function saveAssignmentRule(ctx: RequestContext, organizationId: string, companyId: string, id: string | null, raw: z.input<typeof assignmentRuleInput>) {
  const input = assignmentRuleInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (input.strategy === "BY_CATEGORY" && !input.categoryId) throw conflict("Choose a category", { reason: "support_rule_category" });
    if (input.categoryId && !(await tx.supportCategory.findFirst({ where: { id: input.categoryId, organizationId, companyId }, select: { id: true } }))) throw notFound("Category");
    const agents = await supportAgents(tx, organizationId, chain, input.assigneeIds);
    if (!agents.length) throw conflict("None of these people can handle tickets", { reason: "support_assignee_ineligible" });
    const data = { name: input.name, strategy: input.strategy, categoryId: input.strategy === "BY_CATEGORY" ? (input.categoryId ?? null) : null, assigneeIds: input.assigneeIds.filter((a) => agents.includes(a)), position: input.position, active: input.active };
    if (id) {
      if (!isUuid(id) || !(await tx.supportAssignmentRule.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("Rule");
      return tx.supportAssignmentRule.update({ where: { id }, data });
    }
    const r = await tx.supportAssignmentRule.create({ data: { ...data, organizationId, companyId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "support.assignment_rule.created", resourceType: "support_assignment_rule", resourceId: r.id, newValue: data });
    return r;
  });
}

export const escalationRuleInput = z.object({
  name: z.string().trim().min(1).max(100),
  trigger: z.enum(["FIRST_RESPONSE_BREACH", "RESOLUTION_BREACH"]),
  raisePriority: z.boolean().default(true),
  reassignToId: uuid.nullable().optional(),
  notifyManagers: z.boolean().default(true),
  active: z.boolean().default(true),
});

export async function listEscalationRules(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  return db().supportEscalationRule.findMany({ where: { organizationId, companyId }, orderBy: { createdAt: "asc" } });
}

export async function saveEscalationRule(ctx: RequestContext, organizationId: string, companyId: string, id: string | null, raw: z.input<typeof escalationRuleInput>) {
  const input = escalationRuleInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (input.reassignToId && !(await supportAgents(tx, organizationId, chain, [input.reassignToId])).length) throw conflict("This person can't handle tickets", { reason: "support_assignee_ineligible" });
    const data = { name: input.name, trigger: input.trigger, raisePriority: input.raisePriority, reassignToId: input.reassignToId ?? null, notifyManagers: input.notifyManagers, active: input.active };
    if (id) {
      if (!isUuid(id) || !(await tx.supportEscalationRule.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("Rule");
      return tx.supportEscalationRule.update({ where: { id }, data });
    }
    const r = await tx.supportEscalationRule.create({ data: { ...data, organizationId, companyId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "support.escalation_rule.created", resourceType: "support_escalation_rule", resourceId: r.id, newValue: data });
    return r;
  });
}

export async function deleteRule(ctx: RequestContext, organizationId: string, companyId: string, kind: "assignment" | "escalation", id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (!isUuid(id)) throw notFound("Rule");
    const { count } =
      kind === "assignment"
        ? await tx.supportAssignmentRule.deleteMany({ where: { id, organizationId, companyId } })
        : await tx.supportEscalationRule.deleteMany({ where: { id, organizationId, companyId } });
    if (!count) throw notFound("Rule");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `support.${kind}_rule.deleted`, resourceType: `support_${kind}_rule`, resourceId: id });
    return { ok: true };
  });
}
