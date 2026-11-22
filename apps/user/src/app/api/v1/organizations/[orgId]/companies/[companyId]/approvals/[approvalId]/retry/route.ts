import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { retryApproval } from "@/server/modules/approvals/service";

/** Retry a FAILED approved action (same checks as approving; runs on the worker when available, else inline). */
export const POST = route<{ orgId: string; companyId: string; approvalId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/approvals/:id/retry", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, approvalId }) => retryApproval(ctx, orgId, companyId, approvalId),
);
