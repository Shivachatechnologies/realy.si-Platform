import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getIncident, updateIncident, updateIncidentInput } from "@/server/modules/work/operations";

type P = { orgId: string; companyId: string; incidentId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, incidentId }) => getIncident(ctx, orgId, companyId, incidentId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/operations/incidents/:incidentId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, incidentId }) => updateIncident(ctx, orgId, companyId, incidentId, await body(req, updateIncidentInput)));
