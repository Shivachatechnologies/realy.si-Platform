import { route } from "@/server/core/http";
import { usageSummary } from "@/server/modules/integrations/service";

type P = { orgId: string; companyId: string };

/** Usage and estimated cost per provider and operation. Query: days (1-365, default 30). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 30) || 30, 1), 365);
  return usageSummary(ctx, orgId, companyId, { days });
});
