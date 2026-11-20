import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addVariant, variantInput } from "@/server/modules/marketing/email";

type P = { orgId: string; companyId: string; emailCampaignId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/email/campaigns/:emailCampaignId/variants", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, emailCampaignId }) => addVariant(ctx, orgId, companyId, emailCampaignId, await body(req, variantInput)));
