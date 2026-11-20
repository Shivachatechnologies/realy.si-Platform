import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import type { ScopeChain } from "@/server/modules/rbac/scope";
import { actorId, authorize, companyCurrency, day, eligibleOwnerIds, isUuid, moneyInput, toMinor, uuid } from "./common";
import { CRM_ENTITIES, FIELD_TYPES } from "./custom-fields";

/**
 * CRM configuration records managed from the settings pages, behind one dispatcher: lead sources, custom fields,
 * segments, assignment rules, stage rules, sales targets and commission rules. All writes need sales.manage
 * (segments: sales.read, they are saved views).
 */

export const CONFIG_KINDS = ["sources", "custom-fields", "segments", "assignment-rules", "stage-rules", "targets", "commission-rules"] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];

const tier = z.object({ from: moneyInput, rateBps: z.number().int().min(0).max(10_000) });

const schemas = {
  sources: { create: z.object({ name: z.string().trim().min(1).max(100), position: z.number().int().min(0).max(1000).optional() }) },
  "custom-fields": {
    create: z.object({
      entity: z.enum(CRM_ENTITIES),
      label: z.string().trim().min(1).max(100),
      key: z
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9_]{0,39}$/)
        .optional(),
      type: z.enum(FIELD_TYPES).default("TEXT"),
      options: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
      required: z.boolean().default(false),
      position: z.number().int().min(0).max(1000).optional(),
    }),
  },
  segments: {
    create: z.object({
      entity: z.enum(["LEAD", "CONTACT", "ACCOUNT", "DEAL"]),
      name: z.string().trim().min(1).max(100),
      filters: z.record(z.string().regex(/^[a-zA-Z]{1,20}$/), z.string().max(200)).default({}),
    }),
  },
  "assignment-rules": {
    create: z.object({
      name: z.string().trim().min(1).max(100),
      strategy: z.enum(["ROUND_ROBIN", "FIXED"]).default("ROUND_ROBIN"),
      ownerIds: z.array(uuid).min(1).max(50),
      matchSource: z.string().trim().max(100).optional(),
      matchTerritory: z.string().trim().max(100).optional(),
      /** Follow-up for the assigned owner N days after assignment (omit = none). */
      followUpDays: z.number().int().min(0).max(365).nullable().optional(),
      followUpNote: z.string().trim().max(1000).optional(),
      position: z.number().int().min(0).max(1000).optional(),
      active: z.boolean().default(true),
    }),
  },
  "stage-rules": {
    create: z.object({
      stageId: uuid,
      name: z.string().trim().min(1).max(100),
      createFollowUp: z.boolean().default(false),
      followUpDays: z.number().int().min(0).max(365).default(2),
      followUpNote: z.string().trim().max(1000).optional(),
      createWorkTask: z.boolean().default(false),
      workTaskTitle: z.string().trim().max(200).optional(),
      workTaskDueDays: z.number().int().min(0).max(365).default(1),
      workTaskPriority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
      notifyOwner: z.boolean().default(true),
      active: z.boolean().default(true),
    }),
  },
  targets: {
    create: z.object({
      ownerId: uuid,
      period: z.enum(["MONTH", "QUARTER"]).default("MONTH"),
      periodStart: day,
      amount: moneyInput,
      dealsTarget: z.number().int().min(0).max(100_000).optional(),
    }),
  },
  "commission-rules": {
    create: z.object({
      name: z.string().trim().min(1).max(100),
      rateBps: z.number().int().min(0).max(10_000),
      pipelineId: uuid.optional().or(z.literal("").transform(() => undefined)),
      ownerId: uuid.optional().or(z.literal("").transform(() => undefined)),
      tiers: z.array(tier).max(10).default([]),
      active: z.boolean().default(true),
      position: z.number().int().min(0).max(1000).optional(),
    }),
  },
} as const;

export const configCreateSchema = (kind: ConfigKind) => schemas[kind].create;
export const configKind = (k: string): ConfigKind => {
  if (!(CONFIG_KINDS as readonly string[]).includes(k)) throw notFound("Setting");
  return k as ConfigKind;
};

const slug = (label: string) =>
  label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 40) || "field";

/** Start of the month/quarter containing `d` (UTC). */
export function periodStartOf(period: "MONTH" | "QUARTER", d: Date) {
  const m = d.getUTCMonth();
  return new Date(Date.UTC(d.getUTCFullYear(), period === "QUARTER" ? m - (m % 3) : m, 1));
}

async function requireOwners(tx: Tx, organizationId: string, chain: ScopeChain, ids: string[]) {
  const ok = new Set(await eligibleOwnerIds(tx, organizationId, chain, ids));
  if (ids.some((id) => !ok.has(id))) throw invalid("Everyone must be able to own sales records in this company", { reason: "lead_owner_ineligible" });
}

export async function listConfig(ctx: RequestContext, organizationId: string, companyId: string, kind: ConfigKind) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const where = { organizationId, companyId };
  switch (kind) {
    case "sources":
      return db().crmLeadSource.findMany({ where: { ...where, archivedAt: null }, orderBy: [{ position: "asc" }, { name: "asc" }] });
    case "custom-fields":
      return db().crmCustomField.findMany({ where: { ...where, archivedAt: null }, orderBy: [{ entity: "asc" }, { position: "asc" }, { createdAt: "asc" }] });
    case "segments":
      return db().crmSegment.findMany({ where, orderBy: [{ entity: "asc" }, { name: "asc" }] });
    case "assignment-rules":
      return db().crmAssignmentRule.findMany({ where, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
    case "stage-rules":
      return db().crmStageRule.findMany({ where, orderBy: { createdAt: "asc" }, include: { stage: { select: { name: true, pipeline: { select: { name: true } } } } } });
    case "targets":
      return db().crmSalesTarget.findMany({ where, orderBy: [{ periodStart: "desc" }, { ownerId: "asc" }], take: 500 });
    case "commission-rules":
      return db().crmCommissionRule.findMany({ where, orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { pipeline: { select: { name: true } } } });
  }
}

export async function createConfig(ctx: RequestContext, organizationId: string, companyId: string, kind: ConfigKind, raw: unknown) {
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, kind === "segments" ? "sales.read" : "sales.manage", tx);
    const base = { organizationId, companyId };
    let row: { id: string };
    switch (kind) {
      case "sources": {
        const i = schemas.sources.create.parse(raw);
        const existing = await tx.crmLeadSource.findFirst({ where: { companyId, name: { equals: i.name, mode: "insensitive" } } });
        if (existing && !existing.archivedAt) throw conflict("This source already exists", { reason: "crm_config_duplicate" });
        row = existing
          ? await tx.crmLeadSource.update({ where: { id: existing.id }, data: { archivedAt: null, name: i.name } })
          : await tx.crmLeadSource.create({ data: { ...base, name: i.name, position: i.position ?? (await tx.crmLeadSource.count({ where: { companyId } })) } });
        break;
      }
      case "custom-fields": {
        const i = schemas["custom-fields"].create.parse(raw);
        if (i.type === "SELECT" && !i.options.length) throw invalid("Add at least one option", { reason: "crm_field_options" });
        const key = i.key ?? slug(i.label);
        if (await tx.crmCustomField.findFirst({ where: { companyId, entity: i.entity, key } })) throw conflict("A field with this key exists", { reason: "crm_config_duplicate" });
        if ((await tx.crmCustomField.count({ where: { companyId, entity: i.entity, archivedAt: null } })) >= 50) throw conflict("Too many fields", { reason: "crm_limit" });
        row = await tx.crmCustomField.create({ data: { ...base, entity: i.entity, key, label: i.label, type: i.type, options: i.type === "SELECT" ? i.options : [], required: i.required, position: i.position ?? 0 } });
        break;
      }
      case "segments": {
        const i = schemas.segments.create.parse(raw);
        row = await tx.crmSegment.create({ data: { ...base, entity: i.entity, name: i.name, filters: i.filters, createdById: actorId(ctx, organizationId) } });
        break;
      }
      case "assignment-rules": {
        const i = schemas["assignment-rules"].create.parse(raw);
        await requireOwners(tx, organizationId, chain, i.ownerIds);
        row = await tx.crmAssignmentRule.create({
          data: {
            ...base,
            name: i.name,
            strategy: i.strategy,
            ownerIds: [...new Set(i.ownerIds)],
            matchSource: i.matchSource || null,
            matchTerritory: i.matchTerritory || null,
            followUpDays: i.followUpDays ?? null,
            followUpNote: i.followUpNote || null,
            position: i.position ?? 0,
            active: i.active,
          },
        });
        break;
      }
      case "stage-rules": {
        const i = schemas["stage-rules"].create.parse(raw);
        if (!(await tx.crmPipelineStage.findFirst({ where: { id: i.stageId, organizationId, companyId, archivedAt: null }, select: { id: true } }))) throw notFound("Stage");
        if (!i.createFollowUp && !i.createWorkTask && !i.notifyOwner) throw invalid("Choose at least one action", { reason: "crm_rule_no_action" });
        row = await tx.crmStageRule.create({ data: { ...base, ...i, followUpNote: i.followUpNote || null, workTaskTitle: i.workTaskTitle || null } });
        break;
      }
      case "targets": {
        const i = schemas.targets.create.parse(raw);
        await requireOwners(tx, organizationId, chain, [i.ownerId]);
        const { baseCurrency } = await companyCurrency(tx, organizationId, companyId);
        const periodStart = periodStartOf(i.period, new Date(`${i.periodStart}T00:00:00Z`));
        const amountMinor = toMinor(i.amount, baseCurrency) ?? 0n;
        row = await tx.crmSalesTarget.upsert({
          where: { companyId_ownerId_period_periodStart: { companyId, ownerId: i.ownerId, period: i.period, periodStart } },
          create: { ...base, ownerId: i.ownerId, period: i.period, periodStart, amountMinor, currency: baseCurrency, dealsTarget: i.dealsTarget ?? null },
          update: { amountMinor, dealsTarget: i.dealsTarget ?? null },
        });
        break;
      }
      case "commission-rules": {
        const i = schemas["commission-rules"].create.parse(raw);
        if (i.pipelineId && !(await tx.crmPipeline.findFirst({ where: { id: i.pipelineId, organizationId, companyId }, select: { id: true } }))) throw notFound("Pipeline");
        if (i.ownerId) await requireOwners(tx, organizationId, chain, [i.ownerId]);
        const { baseCurrency } = await companyCurrency(tx, organizationId, companyId);
        const tiers = i.tiers.map((t) => ({ fromMinor: (toMinor(t.from, baseCurrency) ?? 0n).toString(), rateBps: t.rateBps })).sort((a, b) => (BigInt(a.fromMinor) < BigInt(b.fromMinor) ? -1 : 1));
        row = await tx.crmCommissionRule.create({
          data: { ...base, name: i.name, rateBps: i.rateBps, pipelineId: i.pipelineId ?? null, ownerId: i.ownerId ?? null, tiers: tiers as Prisma.InputJsonValue, active: i.active, position: i.position ?? 0 },
        });
        break;
      }
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `crm.${kind}.created`, resourceType: `crm_${kind}`, resourceId: row.id, newValue: raw as Record<string, unknown> });
    return row;
  });
}

const patchSchemas: Record<ConfigKind, z.ZodType<Record<string, unknown>>> = {
  sources: z.object({ name: z.string().trim().min(1).max(100).optional(), position: z.number().int().min(0).max(1000).optional() }),
  "custom-fields": z.object({
    label: z.string().trim().min(1).max(100).optional(),
    options: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    required: z.boolean().optional(),
    position: z.number().int().min(0).max(1000).optional(),
  }),
  segments: z.object({ name: z.string().trim().min(1).max(100).optional() }),
  "assignment-rules": z.object({
    name: z.string().trim().min(1).max(100).optional(),
    active: z.boolean().optional(),
    position: z.number().int().min(0).max(1000).optional(),
    ownerIds: z.array(uuid).min(1).max(50).optional(),
    strategy: z.enum(["ROUND_ROBIN", "FIXED"]).optional(),
    matchSource: z.string().trim().max(100).nullable().optional(),
    matchTerritory: z.string().trim().max(100).nullable().optional(),
    followUpDays: z.number().int().min(0).max(365).nullable().optional(),
    followUpNote: z.string().trim().max(1000).nullable().optional(),
  }),
  "stage-rules": z.object({ active: z.boolean().optional(), name: z.string().trim().min(1).max(100).optional() }),
  targets: z.object({ amount: moneyInput.optional(), dealsTarget: z.number().int().min(0).max(100_000).nullable().optional() }),
  "commission-rules": z.object({ active: z.boolean().optional(), name: z.string().trim().min(1).max(100).optional(), rateBps: z.number().int().min(0).max(10_000).optional() }),
};
export const configPatchSchema = (kind: ConfigKind) => patchSchemas[kind];

export async function updateConfig(ctx: RequestContext, organizationId: string, companyId: string, kind: ConfigKind, id: string, raw: unknown) {
  const input = patchSchemas[kind].parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, kind === "segments" ? "sales.read" : "sales.manage", tx);
    if (!isUuid(id)) throw notFound("Setting");
    const where = { id, organizationId, companyId };
    const found = async (n: number) => {
      if (!n) throw notFound("Setting");
    };
    switch (kind) {
      case "sources":
        await found((await tx.crmLeadSource.updateMany({ where, data: input })).count);
        break;
      case "custom-fields":
        await found((await tx.crmCustomField.updateMany({ where, data: input })).count);
        break;
      case "segments":
        await found((await tx.crmSegment.updateMany({ where, data: input })).count);
        break;
      case "assignment-rules":
        if (input.ownerIds) await requireOwners(tx, organizationId, chain, input.ownerIds as string[]);
        await found((await tx.crmAssignmentRule.updateMany({ where, data: input })).count);
        break;
      case "stage-rules":
        await found((await tx.crmStageRule.updateMany({ where, data: input })).count);
        break;
      case "targets": {
        const { baseCurrency } = await companyCurrency(tx, organizationId, companyId);
        const data: Prisma.CrmSalesTargetUpdateManyMutationInput = {};
        if (input.amount !== undefined) data.amountMinor = toMinor(input.amount as string, baseCurrency) ?? 0n;
        if (input.dealsTarget !== undefined) data.dealsTarget = input.dealsTarget as number | null;
        await found((await tx.crmSalesTarget.updateMany({ where, data })).count);
        break;
      }
      case "commission-rules":
        await found((await tx.crmCommissionRule.updateMany({ where, data: input })).count);
        break;
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `crm.${kind}.updated`, resourceType: `crm_${kind}`, resourceId: id, newValue: input });
    return { ok: true };
  });
}

/** Delete (or archive, for sources/fields that records reference by value) a configuration record. */
export async function deleteConfig(ctx: RequestContext, organizationId: string, companyId: string, kind: ConfigKind, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, kind === "segments" ? "sales.read" : "sales.manage", tx);
    if (!isUuid(id)) throw notFound("Setting");
    const where = { id, organizationId, companyId };
    let n = 0;
    switch (kind) {
      case "sources":
        n = (await tx.crmLeadSource.updateMany({ where, data: { archivedAt: new Date() } })).count;
        break;
      case "custom-fields":
        n = (await tx.crmCustomField.updateMany({ where, data: { archivedAt: new Date() } })).count;
        break;
      case "segments":
        n = (await tx.crmSegment.deleteMany({ where })).count;
        break;
      case "assignment-rules":
        n = (await tx.crmAssignmentRule.deleteMany({ where })).count;
        break;
      case "stage-rules":
        n = (await tx.crmStageRule.deleteMany({ where })).count;
        break;
      case "targets":
        n = (await tx.crmSalesTarget.deleteMany({ where })).count;
        break;
      case "commission-rules":
        n = (await tx.crmCommissionRule.deleteMany({ where })).count;
        break;
    }
    if (!n) throw notFound("Setting");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `crm.${kind}.deleted`, resourceType: `crm_${kind}`, resourceId: id });
    return { ok: true };
  });
}

/** Active lead source names (for pickers). */
export async function sourceNames(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  return (await db().crmLeadSource.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { name: true } })).map((s) => s.name);
}

export async function listSegments(ctx: RequestContext, organizationId: string, companyId: string, entity: "LEAD" | "CONTACT" | "ACCOUNT" | "DEAL") {
  await authorize(ctx, organizationId, companyId, "sales.read");
  return db().crmSegment.findMany({ where: { organizationId, companyId, entity }, orderBy: { name: "asc" }, select: { id: true, name: true, filters: true } });
}
