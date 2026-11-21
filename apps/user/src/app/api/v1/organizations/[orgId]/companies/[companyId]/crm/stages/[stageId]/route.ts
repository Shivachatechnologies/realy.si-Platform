import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveStage, stagePatch, updateStage } from "@/server/modules/crm/pipelines";

type P = { orgId: string; companyId: string; stageId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/stages/:stageId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, stageId }) => updateStage(ctx, orgId, companyId, stageId, await body(req, stagePatch)),
);
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/stages/:stageId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, stageId }) => archiveStage(ctx, orgId, companyId, stageId));
