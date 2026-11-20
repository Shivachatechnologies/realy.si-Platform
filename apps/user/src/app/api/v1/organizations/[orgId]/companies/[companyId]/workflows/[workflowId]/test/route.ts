import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { testRun, testRunInput } from "@/server/modules/automation/service";

type P = { orgId: string; companyId: string; workflowId: string };

/** Test run with a sample event payload (actions are real). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workflows/:workflowId/test", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, workflowId }) => testRun(ctx, orgId, companyId, workflowId, await body(req, testRunInput)),
);
