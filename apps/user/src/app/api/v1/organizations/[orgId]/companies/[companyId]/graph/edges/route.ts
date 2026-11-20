import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createEdge, createEdgeInput } from "@/server/modules/graph/service";

export const POST = route<{ orgId: string; companyId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/graph/edges", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createEdge(ctx, orgId, companyId, await body(req, createEdgeInput)),
);
