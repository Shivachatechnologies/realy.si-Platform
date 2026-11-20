import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createEmailCampaign, emailCampaignInput, listEmailCampaigns, parseEmailFilters } from "@/server/modules/marketing/email";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listEmailCampaigns(ctx, orgId, companyId, parseEmailFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/email/campaigns", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createEmailCampaign(ctx, orgId, companyId, await body(req, emailCampaignInput)));
