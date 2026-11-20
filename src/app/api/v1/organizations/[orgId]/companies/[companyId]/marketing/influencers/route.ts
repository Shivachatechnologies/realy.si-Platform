import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createInfluencer, influencerInput, listInfluencers, parseInfluencerFilters } from "@/server/modules/marketing/community";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listInfluencers(ctx, orgId, companyId, parseInfluencerFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/influencers", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createInfluencer(ctx, orgId, companyId, await body(req, influencerInput)));
