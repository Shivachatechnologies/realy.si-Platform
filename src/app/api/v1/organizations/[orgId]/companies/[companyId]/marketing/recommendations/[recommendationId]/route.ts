import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { recommendationStatusInput, setRecommendationStatus } from "@/server/modules/marketing/recommendations";

type P = { orgId: string; companyId: string; recommendationId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/recommendations/:recommendationId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, recommendationId }) => setRecommendationStatus(ctx, orgId, companyId, recommendationId, await body(req, recommendationStatusInput)));
