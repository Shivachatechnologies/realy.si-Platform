import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createRequest, listRequests, requestInput } from "@/server/modules/hr/policies";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listRequests(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/requests", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createRequest(ctx, orgId, companyId, await body(req, requestInput)));
