import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { requestAdChange } from "@/server/modules/marketing/ads";

const adChangeInput = z.object({ action: z.enum(["launch", "budget", "activate", "pause"]), dailyBudget: z.string().max(20).optional() });
type P = { orgId: string; companyId: string; adCampaignId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/ads/campaigns/:adCampaignId/changes", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, adCampaignId }) => requestAdChange(ctx, orgId, companyId, adCampaignId, await body(req, adChangeInput)));
