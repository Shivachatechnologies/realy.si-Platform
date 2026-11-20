import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { applyPlanAi } from "@/server/modules/work/product-plan";

type P = { orgId: string; companyId: string; productId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/plan/apply", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, productId }) => applyPlanAi(ctx, orgId, companyId, productId));

