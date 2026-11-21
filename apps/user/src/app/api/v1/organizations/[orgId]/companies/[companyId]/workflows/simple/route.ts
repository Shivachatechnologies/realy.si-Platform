import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createSimpleWorkflow, simpleWorkflowInput } from "@/server/modules/automation/simple";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workflows/simple", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  createSimpleWorkflow(ctx, orgId, companyId, await body(req, simpleWorkflowInput)),
);
