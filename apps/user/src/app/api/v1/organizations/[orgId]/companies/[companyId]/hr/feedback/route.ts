import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { feedbackInput, giveFeedback } from "@/server/modules/hr/performance";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/feedback", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => giveFeedback(ctx, orgId, companyId, await body(req, feedbackInput)));
