import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { decideApproval, decideInput } from "@/server/modules/approvals/service";

export const POST = route<{ orgId: string; companyId: string; approvalId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/approvals/:id/decision", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, approvalId }) => decideApproval(ctx, orgId, companyId, approvalId, await body(req, decideInput)),
);
