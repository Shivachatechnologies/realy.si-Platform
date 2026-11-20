import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getWorkflow, updateWorkflow, updateWorkflowInput } from "@/server/modules/automation/service";

type P = { orgId: string; companyId: string; workflowId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, workflowId }) => getWorkflow(ctx, orgId, companyId, workflowId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/workflows/:workflowId", rateLimits: LIMITS.tenantWrite, maxBodyBytes: 256 * 1024 },
  async ({ req, ctx }, { orgId, companyId, workflowId }) => updateWorkflow(ctx, orgId, companyId, workflowId, await body(req, updateWorkflowInput)),
);
