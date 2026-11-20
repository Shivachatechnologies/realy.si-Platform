import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { companyProfileInput, getCompanyProfile, updateCompanyProfile } from "@/server/modules/enterprise/company";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => getCompanyProfile(ctx, orgId, companyId));
export const PUT = route<P>(
  {
    auth: "required",
    name: "PUT /organizations/:orgId/companies/:companyId/enterprise/profile",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ req, ctx }, { orgId, companyId }) => updateCompanyProfile(ctx, orgId, companyId, await body(req, companyProfileInput)),
);
