import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getJourney, journeyInput, saveJourney } from "@/server/modules/marketing/journey";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => getJourney(ctx, orgId, companyId));
export const PUT = route<P>({ auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/marketing/journey", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId }) => saveJourney(ctx, orgId, companyId, await body(req, journeyInput)));
