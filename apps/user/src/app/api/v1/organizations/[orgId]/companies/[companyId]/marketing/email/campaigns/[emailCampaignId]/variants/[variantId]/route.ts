import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteVariant } from "@/server/modules/marketing/email";

type P = { orgId: string; companyId: string; emailCampaignId: string; variantId: string };
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/email/campaigns/:emailCampaignId/variants/:variantId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, emailCampaignId, variantId }) => deleteVariant(ctx, orgId, companyId, emailCampaignId, variantId));
