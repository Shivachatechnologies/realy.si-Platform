import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { aiRequestInput, requestAi } from "@/server/modules/marketing/ai";

type P = { orgId: string; companyId: string; campaignId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/campaigns/:campaignId/ai", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, campaignId }) => requestAi(ctx, orgId, companyId, campaignId, await body(req, aiRequestInput), "marketing_campaign"));
