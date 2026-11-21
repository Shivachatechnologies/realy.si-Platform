import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { decideOptimization, decisionInput } from "@/server/modules/marketing/optimizations";

type P = { orgId: string; companyId: string; optimizationId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/optimizations/:optimizationId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, optimizationId }) => decideOptimization(ctx, orgId, companyId, optimizationId, await body(req, decisionInput)));
