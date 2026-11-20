import { route } from "@/server/core/http";
import { campaignLeads, LEAD_STAGES } from "@/server/modules/marketing/analytics";
import { enumParam, pageParam, param } from "@/server/modules/marketing/common";

type P = { orgId: string; companyId: string; campaignId: string };
/** Leads attributed to the campaign (read-only CRM data). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, campaignId }) => {
  const raw = Object.fromEntries(req.nextUrl.searchParams);
  return campaignLeads(ctx, orgId, companyId, campaignId, { q: param(raw, "q"), stage: enumParam(raw, "stage", LEAD_STAGES), page: pageParam(raw) });
});
