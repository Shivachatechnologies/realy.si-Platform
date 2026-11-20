import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { publishWorkflow } from "@/server/modules/automation/service";

type P = { orgId: string; companyId: string; workflowId: string };

/** Publish the draft as a new immutable version. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workflows/:workflowId/publish", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, workflowId }) => publishWorkflow(ctx, orgId, companyId, workflowId),
);
