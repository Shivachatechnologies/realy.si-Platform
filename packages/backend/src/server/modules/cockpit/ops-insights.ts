import "server-only";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { userNames } from "@/server/modules/work/shared";

async function authorize(ctx: RequestContext, organizationId: string, companyId: string) {
  await requirePermission(ctx, "operations.read", await companyChain(db(), organizationId, companyId));
}

/** Incidents for the severity board: everything not closed, plus what was resolved in the last 14 days. */
export async function incidentBoard(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId);
  const since = new Date(Date.now() - 14 * 86_400_000);
  const rows = await db().opsIncident.findMany({
    where: { organizationId, companyId, OR: [{ status: { in: ["OPEN", "INVESTIGATING", "MITIGATED"] } }, { status: "RESOLVED", resolvedAt: { gte: since } }] },
    orderBy: [{ severity: "asc" }, { occurredAt: "desc" }],
    take: 80,
    select: { id: true, title: true, severity: true, status: true, occurredAt: true, resolvedAt: true, ownerId: true },
  });
  const names = await userNames(db(), rows.map((r) => r.ownerId));
  return rows.map((r) => ({ ...r, ownerName: r.ownerId ? (names.get(r.ownerId) ?? null) : null }));
}

/** Asset register at a glance: count per status and per category, and how many are assigned to someone. */
export async function assetSummary(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId);
  const where = { organizationId, companyId, archivedAt: null };
  const [byStatus, byCategory, assigned] = await Promise.all([
    db().opsAsset.groupBy({ by: ["status"], where, _count: true }),
    db().opsAsset.groupBy({ by: ["category"], where, _count: true, orderBy: { _count: { category: "desc" } }, take: 8 }),
    db().opsAsset.count({ where: { ...where, assignedToId: { not: null } } }),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])) as Record<string, number>,
    byCategory: byCategory.map((r) => ({ category: r.category, count: r._count })),
    assigned,
    total: byStatus.reduce((a, r) => a + r._count, 0),
  };
}
