import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createHeadcountPlan, headcountInput, workforcePlan } from "@/server/modules/hr/planning";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => {
  const plan = await workforcePlan(ctx, orgId, companyId);
  return { data: plan.plans, totals: plan.totals, currency: plan.currency };
});
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/headcount-plans", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  createHeadcountPlan(ctx, orgId, companyId, await body(req, headcountInput)),
);
