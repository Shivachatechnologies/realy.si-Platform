import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adCampaignInput, createAdCampaignDraft } from "@/server/modules/marketing/ads";

type P = { orgId: string; companyId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/ads/campaigns", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createAdCampaignDraft(ctx, orgId, companyId, await body(req, adCampaignInput)));
