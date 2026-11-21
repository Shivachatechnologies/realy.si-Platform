import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { campaignAction, campaignActionInput } from "@/server/modules/voice/campaigns";

type P = { orgId: string; companyId: string; campaignId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voice/campaigns/:campaignId", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, campaignId }) => campaignAction(ctx, orgId, companyId, campaignId, await body(req, campaignActionInput)),
);
