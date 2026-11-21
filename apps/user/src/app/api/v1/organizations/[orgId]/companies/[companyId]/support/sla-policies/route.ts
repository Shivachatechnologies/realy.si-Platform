import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listSlaPolicies, saveSlaPolicy, slaPolicyInput } from "@/server/modules/support/config";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listSlaPolicies(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/support/sla-policies", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => saveSlaPolicy(ctx, orgId, companyId, null, await body(req, slaPolicyInput)),
);
