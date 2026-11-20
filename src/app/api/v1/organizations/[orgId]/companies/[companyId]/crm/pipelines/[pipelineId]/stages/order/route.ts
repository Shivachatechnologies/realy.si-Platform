import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { reorderStages, stageOrderInput } from "@/server/modules/crm/pipelines";

type P = { orgId: string; companyId: string; pipelineId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/pipelines/:pipelineId/stages/order", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, pipelineId }) => reorderStages(ctx, orgId, companyId, pipelineId, await body(req, stageOrderInput)),
);
