import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createPipeline, listPipelines, pipelineInput } from "@/server/modules/crm/pipelines";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listPipelines(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/pipelines", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createPipeline(ctx, orgId, companyId, await body(req, pipelineInput)),
);
