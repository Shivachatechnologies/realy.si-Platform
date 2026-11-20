import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adAiInput, requestAdAi } from "@/server/modules/marketing/ads";

type P = { orgId: string; companyId: string; adCampaignId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/ads/campaigns/:adCampaignId/ai", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, adCampaignId }) => requestAdAi(ctx, orgId, companyId, adCampaignId, await body(req, adAiInput)));
