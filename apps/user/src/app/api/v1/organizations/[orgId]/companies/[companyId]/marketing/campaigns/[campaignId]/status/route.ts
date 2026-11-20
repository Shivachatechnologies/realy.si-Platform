import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { setCampaignStatus, statusInput } from "@/server/modules/marketing/campaigns";

type P = { orgId: string; companyId: string; campaignId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/campaigns/:campaignId/status", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, campaignId }) => setCampaignStatus(ctx, orgId, companyId, campaignId, await body(req, statusInput)));
