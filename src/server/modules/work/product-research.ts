import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { productOf } from "./product-core";
import { actorId, authorize, blank, isUuid, optText } from "./shared";

/** Product research: competitors (notes + links), market-validation entries (evidence) and personas. */

export const VALIDATION_KINDS = ["INTERVIEW", "SURVEY", "EXPERIMENT", "MARKET_DATA", "PREORDER", "OTHER"] as const;
export const VALIDATION_RESULTS = ["PENDING", "VALIDATED", "INVALIDATED", "INCONCLUSIVE"] as const;

const url = z.string().trim().url().max(500).refine((v) => /^https?:\/\//i.test(v), "Use an http(s) link");
const optUrl = url.or(z.literal("")).nullable().optional();

export const competitorInput = z.object({
  name: z.string().trim().min(1).max(120),
  website: optUrl,
  strengths: optText(5000),
  weaknesses: optText(5000),
  notes: optText(10_000),
  links: z.array(url).max(20).default([]),
});
export const updateCompetitorInput = competitorInput.partial();

export const validationInput = z.object({
  kind: z.enum(VALIDATION_KINDS).default("INTERVIEW"),
  hypothesis: z.string().trim().min(1).max(1000),
  evidence: optText(10_000),
  result: z.enum(VALIDATION_RESULTS).default("PENDING"),
  sampleSize: z.number().int().min(0).max(10_000_000).nullable().optional(),
  sourceUrl: optUrl,
});
export const updateValidationInput = validationInput.partial();

export const personaInput = z.object({
  name: z.string().trim().min(1).max(120),
  role: optText(200),
  description: optText(5000),
  goals: optText(5000),
  painPoints: optText(5000),
});
export const updatePersonaInput = personaInput.partial();

const audit = (tx: Tx, ctx: RequestContext, organizationId: string, action: string, resourceType: string, resourceId: string, newValue?: unknown) =>
  writeAudit(tx, ctx, { category: "TENANT", organizationId, action, resourceType, resourceId, newValue });

const nul = <T>(v: T | "" | null | undefined) => (v === undefined ? undefined : (blank(v) ?? null));
/** Drop undefined keys and turn "" into null (partial updates). */
function patch<T extends Record<string, unknown>>(input: T) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = Array.isArray(v) ? v : nul(v as string | null);
  return out;
}

export async function getResearch(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  await productOf(db(), organizationId, companyId, productId);
  const [competitors, validations, personas] = await Promise.all([
    db().productCompetitor.findMany({ where: { productId, companyId }, orderBy: { name: "asc" }, take: 200 }),
    db().productValidation.findMany({ where: { productId, companyId }, orderBy: { createdAt: "desc" }, take: 300 }),
    db().productPersona.findMany({ where: { productId, companyId }, orderBy: { name: "asc" }, take: 100 }),
  ]);
  return { competitors, validations, personas };
}

// ─── Competitors ───

export async function createCompetitor(ctx: RequestContext, organizationId: string, companyId: string, productId: string, raw: z.input<typeof competitorInput>) {
  const input = competitorInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    await productOf(tx, organizationId, companyId, productId);
    const c = await tx.productCompetitor.create({
      data: { organizationId, companyId, productId, name: input.name, website: blank(input.website) ?? null, strengths: blank(input.strengths) ?? null, weaknesses: blank(input.weaknesses) ?? null, notes: blank(input.notes) ?? null, links: input.links, createdById: actorId(ctx, organizationId) },
    });
    await audit(tx, ctx, organizationId, "product_competitor.created", "product_competitor", c.id, { productId, name: c.name });
    return c;
  });
}

async function own<T>(fn: () => Promise<T | null>, what: string, id: string) {
  if (!isUuid(id)) throw notFound(what);
  const r = await fn();
  if (!r) throw notFound(what);
  return r;
}

export async function updateCompetitor(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateCompetitorInput>) {
  const input = updateCompetitorInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    await own(() => tx.productCompetitor.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }), "Competitor", id);
    const c = await tx.productCompetitor.update({ where: { id }, data: patch(input) });
    await audit(tx, ctx, organizationId, "product_competitor.updated", "product_competitor", id, input);
    return c;
  });
}

export async function deleteCompetitor(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const c = await own(() => tx.productCompetitor.findFirst({ where: { id, organizationId, companyId }, select: { id: true, name: true } }), "Competitor", id);
    await tx.productCompetitor.delete({ where: { id } });
    await audit(tx, ctx, organizationId, "product_competitor.deleted", "product_competitor", id, { name: c.name });
    return { ok: true };
  });
}

// ─── Validation ───

export async function createValidation(ctx: RequestContext, organizationId: string, companyId: string, productId: string, raw: z.input<typeof validationInput>) {
  const input = validationInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    await productOf(tx, organizationId, companyId, productId);
    const v = await tx.productValidation.create({
      data: { organizationId, companyId, productId, kind: input.kind, hypothesis: input.hypothesis, evidence: blank(input.evidence) ?? null, result: input.result, sampleSize: input.sampleSize ?? null, sourceUrl: blank(input.sourceUrl) ?? null, createdById: actorId(ctx, organizationId) },
    });
    await audit(tx, ctx, organizationId, "product_validation.created", "product_validation", v.id, { productId, result: v.result });
    return v;
  });
}

export async function updateValidation(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateValidationInput>) {
  const input = updateValidationInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    await own(() => tx.productValidation.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }), "Validation", id);
    const { sampleSize, ...rest } = input;
    const v = await tx.productValidation.update({ where: { id }, data: { ...patch(rest), ...(sampleSize !== undefined ? { sampleSize } : {}) } });
    await audit(tx, ctx, organizationId, "product_validation.updated", "product_validation", id, input);
    return v;
  });
}

export async function deleteValidation(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    await own(() => tx.productValidation.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }), "Validation", id);
    await tx.productValidation.delete({ where: { id } });
    await audit(tx, ctx, organizationId, "product_validation.deleted", "product_validation", id);
    return { ok: true };
  });
}

// ─── Personas ───

export async function createPersona(ctx: RequestContext, organizationId: string, companyId: string, productId: string, raw: z.input<typeof personaInput>) {
  const input = personaInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    await productOf(tx, organizationId, companyId, productId);
    const p = await tx.productPersona.create({
      data: { organizationId, companyId, productId, name: input.name, role: blank(input.role) ?? null, description: blank(input.description) ?? null, goals: blank(input.goals) ?? null, painPoints: blank(input.painPoints) ?? null, createdById: actorId(ctx, organizationId) },
    });
    await audit(tx, ctx, organizationId, "product_persona.created", "product_persona", p.id, { productId, name: p.name });
    return p;
  });
}

export async function updatePersona(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updatePersonaInput>) {
  const input = updatePersonaInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    await own(() => tx.productPersona.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }), "Persona", id);
    const p = await tx.productPersona.update({ where: { id }, data: patch(input) });
    await audit(tx, ctx, organizationId, "product_persona.updated", "product_persona", id, input);
    return p;
  });
}

export async function deletePersona(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    await own(() => tx.productPersona.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }), "Persona", id);
    await tx.productPersona.delete({ where: { id } });
    await audit(tx, ctx, organizationId, "product_persona.deleted", "product_persona", id);
    return { ok: true };
  });
}
