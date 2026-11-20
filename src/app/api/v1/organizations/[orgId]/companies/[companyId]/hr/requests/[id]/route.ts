import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { requestPatch, updateRequest } from "@/server/modules/hr/policies";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/requests/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateRequest(ctx, orgId, companyId, id, await body(req, requestPatch)));
