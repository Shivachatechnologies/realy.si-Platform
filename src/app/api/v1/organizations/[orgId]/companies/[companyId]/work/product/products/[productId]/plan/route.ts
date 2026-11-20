import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listPlans, planInput, startPlan } from "@/server/modules/work/product-plan";

type P = { orgId: string; companyId: string; productId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, productId }) => listPlans(ctx, orgId, companyId, productId));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/products/:productId/plan", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, productId }) => startPlan(ctx, orgId, companyId, productId, await body(req, planInput)));

