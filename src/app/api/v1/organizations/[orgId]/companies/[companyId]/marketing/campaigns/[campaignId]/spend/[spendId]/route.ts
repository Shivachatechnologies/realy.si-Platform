import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteSpend } from "@/server/modules/marketing/campaigns";

type P = { orgId: string; companyId: string; campaignId: string; spendId: string };
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/campaigns/:campaignId/spend/:spendId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, campaignId, spendId }) => deleteSpend(ctx, orgId, companyId, campaignId, spendId));
