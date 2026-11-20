import { route } from "@/server/core/http";
import { campaignPipeline } from "@/server/modules/marketing/analytics";
import { enumParam, pageParam } from "@/server/modules/marketing/common";

type P = { orgId: string; companyId: string; campaignId: string };
/** CRM deals attributed to the campaign: open pipeline, won and lost revenue (read-only). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, campaignId }) => {
  const raw = Object.fromEntries(req.nextUrl.searchParams);
  return campaignPipeline(ctx, orgId, companyId, campaignId, { status: enumParam(raw, "status", ["OPEN", "WON", "LOST"] as const), page: pageParam(raw) });
});
