import "server-only";
import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden, invalid } from "@/server/core/errors";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";

/** Guided journeys that can be saved and resumed. */
export const FLOW_KEYS = ["tasks.composer", "plans.editor", "ops.process", "ops.checklist"] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];

export const draftInput = z.object({
  step: z.number().int().min(0).max(20),
  /** Plain answers only (strings, numbers, booleans, string lists); at most ~20 KB. */
  data: z.record(z.string().max(60), z.union([z.string().max(8000), z.number(), z.boolean(), z.null(), z.array(z.string().max(2000)).max(200)])),
});

const flowKey = (v: string): FlowKey => {
  if (!(FLOW_KEYS as readonly string[]).includes(v)) throw invalid("Unknown guided journey", { reason: "cockpit_unknown_flow" });
  return v as FlowKey;
};

async function scope(ctx: RequestContext, organizationId: string, companyId: string) {
  await requirePermission(ctx, "companies.read", await companyChain(db(), organizationId, companyId));
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("Guided journeys are for signed-in people");
  return ctx.actor.id;
}

export type GuidedDraftState = { step: number; data: Record<string, unknown>; updatedAt: Date } | null;

/** The viewer's saved answers for a journey (null when none). */
export async function getDraft(ctx: RequestContext, organizationId: string, companyId: string, key: string): Promise<GuidedDraftState> {
  const userId = await scope(ctx, organizationId, companyId);
  const row = await db().guidedDraft.findUnique({ where: { companyId_userId_flowKey: { companyId, userId, flowKey: flowKey(key) } } });
  return row && row.organizationId === organizationId ? { step: row.step, data: (row.data ?? {}) as Record<string, unknown>, updatedAt: row.updatedAt } : null;
}

export async function saveDraft(ctx: RequestContext, organizationId: string, companyId: string, key: string, raw: z.input<typeof draftInput>) {
  const input = draftInput.parse(raw);
  if (JSON.stringify(input.data).length > 20_000) throw invalid("Too much to save", { reason: "cockpit_draft_too_large" });
  const userId = await scope(ctx, organizationId, companyId);
  const fk = flowKey(key);
  const row = await db().guidedDraft.upsert({
    where: { companyId_userId_flowKey: { companyId, userId, flowKey: fk } },
    create: { organizationId, companyId, userId, flowKey: fk, step: input.step, data: input.data },
    update: { step: input.step, data: input.data },
  });
  return { step: row.step, updatedAt: row.updatedAt };
}

export async function clearDraft(ctx: RequestContext, organizationId: string, companyId: string, key: string) {
  const userId = await scope(ctx, organizationId, companyId);
  await db().guidedDraft.deleteMany({ where: { organizationId, companyId, userId, flowKey: flowKey(key) } });
  return { ok: true };
}
