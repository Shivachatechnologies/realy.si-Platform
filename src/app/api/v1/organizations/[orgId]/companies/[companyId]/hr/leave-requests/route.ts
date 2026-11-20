import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { leaveRequestInput, listLeaveRequestsApi, requestLeave } from "@/server/modules/hr/time";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: await listLeaveRequestsApi(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/leave-requests", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => requestLeave(ctx, orgId, companyId, await body(req, leaveRequestInput)));
