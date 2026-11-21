import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createIncident, incidentInput, listIncidents } from "@/server/modules/work/operations";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listIncidents(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/operations/incidents", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createIncident(ctx, orgId, companyId, await body(req, incidentInput)));
