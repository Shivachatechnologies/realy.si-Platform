import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { planAction, planActionInput } from "@/server/modules/marketing/plans";

type P = { orgId: string; companyId: string; planId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/plans/:planId/actions", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, planId }) => planAction(ctx, orgId, companyId, planId, await body(req, planActionInput)));
