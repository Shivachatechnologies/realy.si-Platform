import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addSpend, spendInput } from "@/server/modules/marketing/campaigns";

type P = { orgId: string; companyId: string; campaignId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/campaigns/:campaignId/spend", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, campaignId }) => addSpend(ctx, orgId, companyId, campaignId, await body(req, spendInput)));
