import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createWorkflow, createWorkflowInput, listWorkflows, parseWorkflowFilters } from "@/server/modules/automation/service";

type P = { orgId: string; companyId: string };

/** GET ?q=&status= */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({
  data: await listWorkflows(ctx, orgId, companyId, parseWorkflowFilters(Object.fromEntries(req.nextUrl.searchParams))),
}));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workflows", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createWorkflow(ctx, orgId, companyId, await body(req, createWorkflowInput)),
);
