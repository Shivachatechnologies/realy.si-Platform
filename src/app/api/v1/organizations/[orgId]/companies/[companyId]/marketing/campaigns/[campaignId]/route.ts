import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveCampaign, getCampaign, updateCampaign, updateCampaignInput } from "@/server/modules/marketing/campaigns";

type P = { orgId: string; companyId: string; campaignId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, campaignId }) => getCampaign(ctx, orgId, companyId, campaignId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/campaigns/:campaignId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, campaignId }) => updateCampaign(ctx, orgId, companyId, campaignId, await body(req, updateCampaignInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/campaigns/:campaignId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, campaignId }) => archiveCampaign(ctx, orgId, companyId, campaignId));
