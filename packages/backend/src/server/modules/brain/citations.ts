import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import type { AgentTaskStatus } from "@/generated/prisma/enums";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";

export interface DocumentCitationUse {
  taskId: string;
  title: string;
  profile: string;
  status: AgentTaskStatus;
  createdAt: Date;
  /** Passage numbers of this document the task cited, ascending. */
  passages: number[];
}

/**
 * Where a document is cited: AI tasks of the same company whose stored citations reference it (newest first).
 * Returns null when the viewer may not read AI tasks.
 */
export async function documentCitations(ctx: RequestContext, organizationId: string, companyId: string, documentId: string, limit = 20): Promise<DocumentCitationUse[] | null> {
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "brain.read", chain);
  if (!(await can(ctx, "agents.read", chain))) return null;
  const probe = JSON.stringify([{ documentId }]);
  const rows = await db().$queryRaw<{ id: string; title: string; profile: string; status: AgentTaskStatus; created_at: Date; citations: { documentId?: string; passage?: number }[] }[]>`
    SELECT id, title, profile, status, created_at, citations
      FROM agent_tasks
     WHERE organization_id = ${organizationId}::uuid AND company_id = ${companyId}::uuid
       AND citations @> ${probe}::jsonb
     ORDER BY created_at DESC
     LIMIT ${limit}`;
  return rows.map((r) => ({
    taskId: r.id,
    title: r.title,
    profile: r.profile,
    status: r.status,
    createdAt: r.created_at,
    passages: [...new Set((Array.isArray(r.citations) ? r.citations : []).filter((c) => c.documentId === documentId && typeof c.passage === "number").map((c) => c.passage!))].sort((a, b) => a - b),
  }));
}
