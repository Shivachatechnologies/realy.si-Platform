import { route } from "@/server/core/http";
import { getAdCampaign } from "@/server/modules/marketing/ads";

type P = { orgId: string; companyId: string; adCampaignId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, adCampaignId }) => getAdCampaign(ctx, orgId, companyId, adCampaignId));
