import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { askPolicyAssistant, policyQuestionInput } from "@/server/modules/hr/assist";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/assist/policy", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => askPolicyAssistant(ctx, orgId, companyId, await body(req, policyQuestionInput)));
