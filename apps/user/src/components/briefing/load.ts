import "server-only";
import { db } from "@/server/core/db";

/** Ids of the listed approvals that are still pending now (only those get decision buttons). */
export async function pendingApprovalIds(organizationId: string, companyId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db().approval.findMany({ where: { id: { in: ids }, organizationId, companyId, status: "PENDING", expiresAt: { gt: new Date() } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}
