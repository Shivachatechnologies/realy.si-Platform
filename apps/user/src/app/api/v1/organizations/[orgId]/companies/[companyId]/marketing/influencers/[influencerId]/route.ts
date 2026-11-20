import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveInfluencer, updateInfluencer, updateInfluencerInput } from "@/server/modules/marketing/community";

type P = { orgId: string; companyId: string; influencerId: string };
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/influencers/:influencerId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, influencerId }) => updateInfluencer(ctx, orgId, companyId, influencerId, await body(req, updateInfluencerInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/influencers/:influencerId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, influencerId }) => archiveInfluencer(ctx, orgId, companyId, influencerId));
