import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createGoal, goalInput, listGoals } from "@/server/modules/marketing/intelligence";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => listGoals(ctx, orgId, companyId));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/goals", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createGoal(ctx, orgId, companyId, await body(req, goalInput)));
