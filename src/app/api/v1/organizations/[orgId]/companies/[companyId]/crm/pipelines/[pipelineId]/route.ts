import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archivePipeline, pipelinePatch, updatePipeline } from "@/server/modules/crm/pipelines";

type P = { orgId: string; companyId: string; pipelineId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/pipelines/:pipelineId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, pipelineId }) => updatePipeline(ctx, orgId, companyId, pipelineId, await body(req, pipelinePatch)),
);
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/pipelines/:pipelineId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, pipelineId }) =>
  archivePipeline(ctx, orgId, companyId, pipelineId),
);
