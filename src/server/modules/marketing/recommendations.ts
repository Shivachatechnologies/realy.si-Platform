import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { authorize, isUuid } from "./common";

export const RECOMMENDATION_STATUSES = ["OPEN", "DONE", "DISMISSED"] as const;
export const recommendationStatusInput = z.object({ status: z.enum(RECOMMENDATION_STATUSES) });

/** Create (or refresh) an open "what to do next" item. Returns true when a new one was created. */
export async function upsertRecommendation(
  organizationId: string,
  companyId: string,
  r: { dedupeKey: string; title: string; detail?: string; priority?: "high" | "medium" | "low"; href?: string; source?: string },
): Promise<boolean> {
  const existing = await db().marketingRecommendation.findUnique({ where: { companyId_dedupeKey: { companyId, dedupeKey: r.dedupeKey } }, select: { id: true, status: true } });
  if (existing) {
    if (existing.status === "OPEN") await db().marketingRecommendation.update({ where: { id: existing.id }, data: { title: r.title.slice(0, 300), detail: r.detail?.slice(0, 4000) ?? null } });
    return false;
  }
  try {
    await db().marketingRecommendation.create({
      data: { organizationId, companyId, dedupeKey: r.dedupeKey, title: r.title.slice(0, 300), detail: r.detail?.slice(0, 4000) ?? null, priority: r.priority ?? "medium", href: r.href ?? null, source: r.source ?? "loop" },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

export async function listRecommendations(ctx: RequestContext, organizationId: string, companyId: string, status: (typeof RECOMMENDATION_STATUSES)[number] = "OPEN", take = 50) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const rows = await db().marketingRecommendation.findMany({ where: { organizationId, companyId, status }, orderBy: [{ createdAt: "desc" }], take });
  const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  return rows.sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1));
}

export async function setRecommendationStatus(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof recommendationStatusInput>) {
  const { status } = recommendationStatusInput.parse(raw);
  if (!isUuid(id)) throw notFound("Recommendation");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingRecommendation.updateMany({ where: { id, organizationId, companyId }, data: { status } });
    if (!count) throw notFound("Recommendation");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.recommendation.status", resourceType: "marketing_recommendation", resourceId: id, newValue: { status } });
    return { ok: true };
  });
}
