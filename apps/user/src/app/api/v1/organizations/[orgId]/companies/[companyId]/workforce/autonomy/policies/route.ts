import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { policyInput, setAutonomyPolicy } from "@/server/modules/workforce/autonomy-service";

type P = { orgId: string; companyId: string };

/** Set (or with level null, remove) the autonomy rule of a department ("*" = company) for one action class. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/autonomy/policies", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => setAutonomyPolicy(ctx, orgId, companyId, await body(req, policyInput)),
);
