import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createGoal, goalInput } from "@/server/modules/hr/performance";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/goals", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createGoal(ctx, orgId, companyId, await body(req, goalInput)));
