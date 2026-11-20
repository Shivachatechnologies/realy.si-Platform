import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteEmailCampaign, getEmailCampaign, updateEmailCampaign, updateEmailCampaignInput } from "@/server/modules/marketing/email";

type P = { orgId: string; companyId: string; emailCampaignId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, emailCampaignId }) => getEmailCampaign(ctx, orgId, companyId, emailCampaignId, req.nextUrl.searchParams.get("status") ?? undefined));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/email/campaigns/:emailCampaignId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, emailCampaignId }) => updateEmailCampaign(ctx, orgId, companyId, emailCampaignId, await body(req, updateEmailCampaignInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/email/campaigns/:emailCampaignId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, emailCampaignId }) => deleteEmailCampaign(ctx, orgId, companyId, emailCampaignId));
