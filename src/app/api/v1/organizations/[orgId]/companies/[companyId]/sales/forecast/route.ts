import { route } from "@/server/core/http";
import { salesForecast } from "@/server/modules/crm/sales";

type P = { orgId: string; companyId: string };

/** GET ?months=6&owner=&pipeline= */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const q = req.nextUrl.searchParams;
  return salesForecast(ctx, orgId, companyId, { months: Number(q.get("months")) || 6, owner: q.get("owner") || undefined, pipelineId: q.get("pipeline") || undefined });
});
