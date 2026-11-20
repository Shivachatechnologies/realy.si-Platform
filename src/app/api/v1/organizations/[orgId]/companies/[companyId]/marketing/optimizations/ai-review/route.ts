import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { requestAiOptimizationReview } from "@/server/modules/marketing/optimizations";

type P = { orgId: string; companyId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/optimizations/ai-review", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId }) => requestAiOptimizationReview(ctx, orgId, companyId));
