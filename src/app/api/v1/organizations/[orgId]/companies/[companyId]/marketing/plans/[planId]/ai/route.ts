import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { draftPlanWithAi, planAiInput } from "@/server/modules/marketing/plans";

type P = { orgId: string; companyId: string; planId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/plans/:planId/ai", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, planId }) => draftPlanWithAi(ctx, orgId, companyId, planId, await body(req, planAiInput)));
