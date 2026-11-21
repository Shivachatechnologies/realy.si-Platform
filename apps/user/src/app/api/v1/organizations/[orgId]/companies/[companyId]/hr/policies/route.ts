import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createPolicy, listPolicies, policyInput } from "@/server/modules/hr/policies";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listPolicies(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/policies", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: 256 * 1024 }, async ({ req, ctx }, { orgId, companyId }) => createPolicy(ctx, orgId, companyId, await body(req, policyInput)));
