import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { cancelPlan } from "@/server/modules/work/product-plan";

type P = { orgId: string; companyId: string; runId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/plans/:runId/cancel", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, runId }) => cancelPlan(ctx, orgId, companyId, runId));

