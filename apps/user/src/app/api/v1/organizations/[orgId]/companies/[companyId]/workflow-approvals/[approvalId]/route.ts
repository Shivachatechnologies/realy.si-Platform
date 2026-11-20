import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { decideInput, decideWorkflowApproval } from "@/server/modules/automation/service";

type P = { orgId: string; companyId: string; approvalId: string };

/** Approve or reject a workflow approval step. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workflow-approvals/:approvalId", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, approvalId }) => decideWorkflowApproval(ctx, orgId, companyId, approvalId, await body(req, decideInput)),
);
