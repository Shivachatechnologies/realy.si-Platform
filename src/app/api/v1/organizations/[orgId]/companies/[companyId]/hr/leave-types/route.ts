import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createLeaveType, leaveTypeInput, listLeaveTypes } from "@/server/modules/hr/time";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listLeaveTypes(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/leave-types", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createLeaveType(ctx, orgId, companyId, await body(req, leaveTypeInput)));
