import { route } from "@/server/core/http";
import { costOverview } from "@/server/modules/costs/service";

type P = { orgId: string; companyId: string };

/** Cost dashboard data from the unified cost ledger (micro-USD strings): totals, forecast, breakdowns, budgets, alerts. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => costOverview(ctx, orgId, companyId, { days: req.nextUrl.searchParams.get("days") }));
