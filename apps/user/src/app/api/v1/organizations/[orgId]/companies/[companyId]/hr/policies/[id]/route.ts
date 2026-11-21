import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archivePolicy, getPolicy, policyPatch, updatePolicy } from "@/server/modules/hr/policies";

type P = { orgId: string; companyId: string; id: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, id }) => getPolicy(ctx, orgId, companyId, id));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/policies/:id", rateLimits: LIMITS.tenantWrite, maxBodyBytes: 256 * 1024 }, async ({ req, ctx }, { orgId, companyId, id }) => updatePolicy(ctx, orgId, companyId, id, await body(req, policyPatch)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/policies/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => archivePolicy(ctx, orgId, companyId, id));
