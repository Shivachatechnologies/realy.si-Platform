import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createCampaign, createCampaignInput, listCampaigns, parseCampaignFilters } from "@/server/modules/marketing/campaigns";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listCampaigns(ctx, orgId, companyId, parseCampaignFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/campaigns", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createCampaign(ctx, orgId, companyId, await body(req, createCampaignInput)));
