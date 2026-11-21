import { z } from "zod";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { authorize, isUuid } from "./common";

export const STAGE_TYPES = ["OPEN", "WON", "LOST"] as const;

const DEFAULT_STAGES = [
  { name: "Qualification", probability: 10, type: "OPEN" },
  { name: "Needs analysis", probability: 25, type: "OPEN" },
  { name: "Proposal", probability: 50, type: "OPEN" },
  { name: "Negotiation", probability: 75, type: "OPEN" },
  { name: "Won", probability: 100, type: "WON" },
  { name: "Lost", probability: 0, type: "LOST" },
] as const;

export const pipelineInput = z.object({
  name: z.string().trim().min(1).max(100),
  staleDays: z.number().int().min(1).max(365).optional(),
  isDefault: z.boolean().optional(),
  /** Create the standard stages (default true). */
  withDefaultStages: z.boolean().default(true),
});
export const pipelinePatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  staleDays: z.number().int().min(1).max(365).optional(),
  isDefault: z.literal(true).optional(),
  position: z.number().int().min(0).max(1000).optional(),
});
export const stageInput = z.object({
  name: z.string().trim().min(1).max(100),
  probability: z.number().int().min(0).max(100),
  type: z.enum(STAGE_TYPES).default("OPEN"),
  position: z.number().int().min(0).max(1000).optional(),
});
export const stagePatch = stageInput.partial();
export const stageOrderInput = z.object({ stageIds: z.array(z.string().uuid()).min(1).max(50) });

/**
 * The company's pipelines with active stages. Creates a default pipeline lazily (idempotent under a row lock on the
 * company) so every company has somewhere to put deals.
 */
export async function ensureDefaultPipeline(tx: Tx, organizationId: string, companyId: string) {
  const existing = await tx.crmPipeline.findFirst({ where: { companyId, archivedAt: null }, select: { id: true } });
  if (existing) return;
  await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
  if (await tx.crmPipeline.findFirst({ where: { companyId, archivedAt: null }, select: { id: true } })) return;
  const p = await tx.crmPipeline.create({ data: { organizationId, companyId, name: "Sales pipeline", isDefault: true } });
  await tx.crmPipelineStage.createMany({ data: DEFAULT_STAGES.map((s, i) => ({ organizationId, companyId, pipelineId: p.id, name: s.name, probability: s.probability, type: s.type, position: i })) });
}

async function loadPipelines(client: Tx | Db, organizationId: string, companyId: string) {
  return client.crmPipeline.findMany({
    where: { organizationId, companyId, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }, { createdAt: "asc" }],
    include: { stages: { where: { archivedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] } },
  });
}

export async function listPipelines(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  let pipelines = await loadPipelines(db(), organizationId, companyId);
  if (!pipelines.length) {
    await transaction((tx) => ensureDefaultPipeline(tx, organizationId, companyId));
    pipelines = await loadPipelines(db(), organizationId, companyId);
  }
  return pipelines;
}
export type PipelineWithStages = Awaited<ReturnType<typeof listPipelines>>[number];

/** Default pipeline and its first open stage (for new deals). */
export async function defaultPlacement(tx: Tx, organizationId: string, companyId: string, pipelineId?: string | null, stageId?: string | null) {
  await ensureDefaultPipeline(tx, organizationId, companyId);
  const pipeline = await tx.crmPipeline.findFirst({
    where: { organizationId, companyId, archivedAt: null, ...(pipelineId ? { id: pipelineId } : {}) },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }],
    include: { stages: { where: { archivedAt: null }, orderBy: { position: "asc" } } },
  });
  if (!pipeline) throw notFound("Pipeline");
  const stage = stageId ? pipeline.stages.find((s) => s.id === stageId) : (pipeline.stages.find((s) => s.type === "OPEN") ?? pipeline.stages[0]);
  if (!stage) throw invalid("Choose a stage of this pipeline", { reason: "crm_stage_invalid" });
  return { pipeline, stage };
}

export async function createPipeline(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof pipelineInput>) {
  const input = pipelineInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const count = await tx.crmPipeline.count({ where: { companyId, archivedAt: null } });
    if (count >= 20) throw conflict("Too many pipelines", { reason: "crm_limit" });
    const makeDefault = input.isDefault || count === 0;
    if (makeDefault) await tx.crmPipeline.updateMany({ where: { companyId }, data: { isDefault: false } });
    const p = await tx.crmPipeline.create({ data: { organizationId, companyId, name: input.name, staleDays: input.staleDays ?? 30, isDefault: makeDefault, position: count } });
    if (input.withDefaultStages) {
      await tx.crmPipelineStage.createMany({ data: DEFAULT_STAGES.map((s, i) => ({ organizationId, companyId, pipelineId: p.id, name: s.name, probability: s.probability, type: s.type, position: i })) });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.pipeline.created", resourceType: "crm_pipeline", resourceId: p.id, newValue: { name: p.name } });
    return p;
  });
}

async function requirePipeline(tx: Tx, organizationId: string, companyId: string, id: string) {
  const p = isUuid(id) ? await tx.crmPipeline.findFirst({ where: { id, organizationId, companyId, archivedAt: null } }) : null;
  if (!p) throw notFound("Pipeline");
  return p;
}

export async function updatePipeline(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof pipelinePatch>) {
  const input = pipelinePatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    await requirePipeline(tx, organizationId, companyId, id);
    if (input.isDefault) await tx.crmPipeline.updateMany({ where: { companyId }, data: { isDefault: false } });
    const p = await tx.crmPipeline.update({ where: { id }, data: input });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.pipeline.updated", resourceType: "crm_pipeline", resourceId: id, newValue: input });
    return p;
  });
}

/** Archive a pipeline. Refused while it has open deals or if it is the last one. */
export async function archivePipeline(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const p = await requirePipeline(tx, organizationId, companyId, id);
    if ((await tx.crmPipeline.count({ where: { companyId, archivedAt: null } })) <= 1) throw conflict("Keep at least one pipeline", { reason: "crm_last_pipeline" });
    if (await tx.crmDeal.count({ where: { pipelineId: id, status: "OPEN", archivedAt: null } })) throw conflict("Move or close the open deals first", { reason: "crm_pipeline_has_deals" });
    await tx.crmPipeline.update({ where: { id }, data: { archivedAt: new Date(), isDefault: false } });
    if (p.isDefault) {
      const next = await tx.crmPipeline.findFirst({ where: { companyId, archivedAt: null }, orderBy: { position: "asc" } });
      if (next) await tx.crmPipeline.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.pipeline.archived", resourceType: "crm_pipeline", resourceId: id });
    return { ok: true };
  });
}

export async function addStage(ctx: RequestContext, organizationId: string, companyId: string, pipelineId: string, raw: z.input<typeof stageInput>) {
  const input = stageInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    await requirePipeline(tx, organizationId, companyId, pipelineId);
    const count = await tx.crmPipelineStage.count({ where: { pipelineId, archivedAt: null } });
    if (count >= 30) throw conflict("Too many stages", { reason: "crm_limit" });
    const s = await tx.crmPipelineStage.create({
      data: { organizationId, companyId, pipelineId, name: input.name, probability: input.probability, type: input.type, position: input.position ?? count },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.stage.created", resourceType: "crm_stage", resourceId: s.id, newValue: input });
    return s;
  });
}

async function requireStage(tx: Tx, organizationId: string, companyId: string, id: string) {
  const s = isUuid(id) ? await tx.crmPipelineStage.findFirst({ where: { id, organizationId, companyId, archivedAt: null } }) : null;
  if (!s) throw notFound("Stage");
  return s;
}

export async function updateStage(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof stagePatch>) {
  const input = stagePatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const before = await requireStage(tx, organizationId, companyId, id);
    if (input.type && input.type !== before.type && (await tx.crmDeal.count({ where: { stageId: id, archivedAt: null } }))) {
      throw conflict("Move the deals out of this stage before changing its type", { reason: "crm_stage_has_deals" });
    }
    const s = await tx.crmPipelineStage.update({ where: { id }, data: input });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.stage.updated", resourceType: "crm_stage", resourceId: id, oldValue: before, newValue: input });
    return s;
  });
}

/** Reorder the stages of one pipeline (ids in the new order). */
export async function reorderStages(ctx: RequestContext, organizationId: string, companyId: string, pipelineId: string, raw: z.input<typeof stageOrderInput>) {
  const { stageIds } = stageOrderInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    await requirePipeline(tx, organizationId, companyId, pipelineId);
    const stages = await tx.crmPipelineStage.findMany({ where: { pipelineId, archivedAt: null }, select: { id: true } });
    if (stages.length !== stageIds.length || !stages.every((s) => stageIds.includes(s.id))) throw invalid("List every stage of the pipeline once");
    for (const [i, id] of stageIds.entries()) await tx.crmPipelineStage.update({ where: { id }, data: { position: i } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.stage.reordered", resourceType: "crm_pipeline", resourceId: pipelineId, newValue: { stageIds } });
    return { ok: true };
  });
}

export async function archiveStage(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const s = await requireStage(tx, organizationId, companyId, id);
    if (await tx.crmDeal.count({ where: { stageId: id, archivedAt: null } })) throw conflict("Move the deals out of this stage first", { reason: "crm_stage_has_deals" });
    if ((await tx.crmPipelineStage.count({ where: { pipelineId: s.pipelineId, archivedAt: null, type: "OPEN" } })) <= 1 && s.type === "OPEN") {
      throw conflict("A pipeline needs at least one open stage", { reason: "crm_last_stage" });
    }
    await tx.crmPipelineStage.update({ where: { id }, data: { archivedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.stage.archived", resourceType: "crm_stage", resourceId: id });
    return { ok: true };
  });
}
