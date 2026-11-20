import { route } from "@/server/core/http";
import { rangeParams, resolveRange } from "@/server/modules/bi/range";
import { metricContext, metricValues } from "@/server/modules/bi/service";

type P = { orgId: string; companyId: string };

/** Values of every visible metric (optionally one department) for a range, with the previous period. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const q = Object.fromEntries(req.nextUrl.searchParams);
  const { range, from, to } = rangeParams.parse(q);
  const { scope, metrics } = await metricContext(ctx, orgId, companyId);
  const chosen = q.department ? metrics.filter((m) => m.department === q.department) : metrics;
  const r = resolveRange(range, from, to);
  return { range: r, currency: scope.currency, data: await metricValues(chosen, scope, r) };
});
