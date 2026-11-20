import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { cyclePatch, getCycle, updateCycle } from "@/server/modules/hr/performance";

type P = { orgId: string; companyId: string; id: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, id }) => getCycle(ctx, orgId, companyId, id));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/review-cycles/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateCycle(ctx, orgId, companyId, id, await body(req, cyclePatch)));
