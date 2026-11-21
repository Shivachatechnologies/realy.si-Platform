import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { campaignInput, createCampaign, listCampaigns } from "@/server/modules/voice/campaigns";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listCampaigns(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voice/campaigns", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createCampaign(ctx, orgId, companyId, await body(req, campaignInput)),
);
