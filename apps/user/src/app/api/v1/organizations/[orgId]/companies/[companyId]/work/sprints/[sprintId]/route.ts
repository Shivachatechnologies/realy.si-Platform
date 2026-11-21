import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteSprint, getSprint, updateSprint, updateSprintInput } from "@/server/modules/work/agile";

type P = { orgId: string; companyId: string; sprintId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, sprintId }) => getSprint(ctx, orgId, companyId, sprintId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/sprints/:sprintId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, sprintId }) => updateSprint(ctx, orgId, companyId, sprintId, await body(req, updateSprintInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/sprints/:sprintId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, sprintId }) => deleteSprint(ctx, orgId, companyId, sprintId));
