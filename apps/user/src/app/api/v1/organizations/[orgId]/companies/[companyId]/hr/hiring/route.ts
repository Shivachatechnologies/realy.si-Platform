import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listHiringJourneys, startHiring, startHiringInput } from "@/server/modules/hr/hiring";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listHiringJourneys(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/hiring", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  startHiring(ctx, orgId, companyId, await body(req, startHiringInput)),
);
