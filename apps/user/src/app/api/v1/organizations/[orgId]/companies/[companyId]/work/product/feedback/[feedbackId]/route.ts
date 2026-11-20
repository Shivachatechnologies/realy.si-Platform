import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { updateFeedback, updateFeedbackInput } from "@/server/modules/work/product";

type P = { orgId: string; companyId: string; feedbackId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/product/feedback/:feedbackId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, feedbackId }) => updateFeedback(ctx, orgId, companyId, feedbackId, await body(req, updateFeedbackInput)));
