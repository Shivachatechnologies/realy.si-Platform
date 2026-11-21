import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createCycle, cycleInput, listCycles } from "@/server/modules/hr/performance";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listCycles(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/review-cycles", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createCycle(ctx, orgId, companyId, await body(req, cycleInput)));
