import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getFeature, updateFeature, updateFeatureInput } from "@/server/modules/work/product";

type P = { orgId: string; companyId: string; featureId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, featureId }) => getFeature(ctx, orgId, companyId, featureId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/product/features/:featureId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, featureId }) => updateFeature(ctx, orgId, companyId, featureId, await body(req, updateFeatureInput)));
