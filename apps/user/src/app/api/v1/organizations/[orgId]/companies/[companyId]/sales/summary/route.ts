import { route } from "@/server/core/http";
import { parseSalesRange, salesSummary, teamPerformance } from "@/server/modules/crm/sales";

type P = { orgId: string; companyId: string };

/** GET ?from=&to=&owner=&pipeline=&source= — headline numbers and the leaderboard. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const r = parseSalesRange(Object.fromEntries(req.nextUrl.searchParams));
  const [summary, team] = await Promise.all([salesSummary(ctx, orgId, companyId, r), teamPerformance(ctx, orgId, companyId, r)]);
  return { summary, leaderboard: team.rows };
});
