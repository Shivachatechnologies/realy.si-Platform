import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addStage, stageInput } from "@/server/modules/crm/pipelines";

type P = { orgId: string; companyId: string; pipelineId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/pipelines/:pipelineId/stages", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, pipelineId }) => addStage(ctx, orgId, companyId, pipelineId, await body(req, stageInput)),
);
