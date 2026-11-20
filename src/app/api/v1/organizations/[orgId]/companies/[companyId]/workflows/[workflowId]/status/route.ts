import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { setWorkflowStatus, statusInput } from "@/server/modules/automation/service";

type P = { orgId: string; companyId: string; workflowId: string };

/** Enable, pause or archive. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workflows/:workflowId/status", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, workflowId }) => setWorkflowStatus(ctx, orgId, companyId, workflowId, await body(req, statusInput)),
);
