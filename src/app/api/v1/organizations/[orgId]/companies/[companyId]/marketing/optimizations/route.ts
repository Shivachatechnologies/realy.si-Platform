import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { enumParam } from "@/server/modules/marketing/common";
import { listOptimizations, OPTIMIZATION_STATUSES, runOptimizationCheck } from "@/server/modules/marketing/optimizations";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listOptimizations(ctx, orgId, companyId, enumParam(Object.fromEntries(req.nextUrl.searchParams), "status", OPTIMIZATION_STATUSES)));
/** Run the optimization rules now. */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/optimizations", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId }) => runOptimizationCheck(ctx, orgId, companyId));
