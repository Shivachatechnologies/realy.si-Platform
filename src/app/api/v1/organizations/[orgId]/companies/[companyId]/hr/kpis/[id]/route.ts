import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteKpi, kpiPatch, updateKpi } from "@/server/modules/hr/performance";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/kpis/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateKpi(ctx, orgId, companyId, id, await body(req, kpiPatch)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/kpis/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => deleteKpi(ctx, orgId, companyId, id));
