import { route } from "@/server/core/http";
import { targetAttainment } from "@/server/modules/crm/sales";

type P = { orgId: string; companyId: string };

/** GET ?period=MONTH|QUARTER&at=YYYY-MM-DD — targets with attainment. Targets are edited via crm/settings/targets. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const q = req.nextUrl.searchParams;
  const at = /^\d{4}-\d{2}-\d{2}$/.test(q.get("at") ?? "") ? new Date(`${q.get("at")}T00:00:00Z`) : new Date();
  return targetAttainment(ctx, orgId, companyId, q.get("period") === "QUARTER" ? "QUARTER" : "MONTH", at);
});
