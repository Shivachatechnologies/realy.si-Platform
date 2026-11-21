import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { pipelineReview, pipelineReviewInput } from "@/server/modules/crm/ai-assist";

type P = { orgId: string; companyId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/pipelines/review", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => pipelineReview(ctx, orgId, companyId, await body(req, pipelineReviewInput)),
);
