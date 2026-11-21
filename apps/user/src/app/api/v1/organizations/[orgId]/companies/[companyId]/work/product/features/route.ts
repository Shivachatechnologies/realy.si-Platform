import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createFeature, featureInput, listFeatures, parseFeatureFilters } from "@/server/modules/work/product";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listFeatures(ctx, orgId, companyId, parseFeatureFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/product/features", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createFeature(ctx, orgId, companyId, await body(req, featureInput)));
