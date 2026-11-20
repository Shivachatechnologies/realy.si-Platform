import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { retryPlan } from "@/server/modules/work/product-plan";

type P = { orgId: string; companyId: string; runId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/plans/:runId/retry", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, runId }) => retryPlan(ctx, orgId, companyId, runId));

