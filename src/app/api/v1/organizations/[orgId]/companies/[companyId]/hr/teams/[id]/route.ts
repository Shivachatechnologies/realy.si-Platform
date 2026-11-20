import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveTeam, teamPatch, updateTeam } from "@/server/modules/hr/org";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/teams/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateTeam(ctx, orgId, companyId, id, await body(req, teamPatch)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/teams/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => archiveTeam(ctx, orgId, companyId, id));
