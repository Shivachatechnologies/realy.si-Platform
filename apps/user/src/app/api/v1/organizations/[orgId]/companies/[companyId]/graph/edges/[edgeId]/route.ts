import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteEdge } from "@/server/modules/graph/service";

export const DELETE = route<{ orgId: string; companyId: string; edgeId: string }>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/graph/edges/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, edgeId }) => deleteEdge(ctx, orgId, companyId, edgeId),
);
