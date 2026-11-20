import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getStrategy, saveStrategy, strategyInput } from "@/server/modules/objectives/goals";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => getStrategy(ctx, orgId, companyId));
export const PUT = route<P>(
  { auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/strategy", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId }) => saveStrategy(ctx, orgId, companyId, await body(req, strategyInput)),
);
