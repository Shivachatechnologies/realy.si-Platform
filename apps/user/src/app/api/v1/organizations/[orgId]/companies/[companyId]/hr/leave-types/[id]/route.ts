import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveLeaveType, leaveTypePatch, updateLeaveType } from "@/server/modules/hr/time";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/leave-types/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateLeaveType(ctx, orgId, companyId, id, await body(req, leaveTypePatch)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/leave-types/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => archiveLeaveType(ctx, orgId, companyId, id));
