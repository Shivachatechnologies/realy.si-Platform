import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { archiveGoal } from "@/server/modules/marketing/intelligence";

type P = { orgId: string; companyId: string; goalId: string };
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/goals/:goalId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, goalId }) => archiveGoal(ctx, orgId, companyId, goalId));
