import { route } from "@/server/core/http";
import { notFound } from "@/server/core/errors";
import { rangeParams, resolveRange } from "@/server/modules/bi/range";
import { metaOf, metricContext, metricSeries } from "@/server/modules/bi/service";

type P = { orgId: string; companyId: string; metricKey: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, metricKey }) => {
  const { range, from, to } = rangeParams.parse(Object.fromEntries(req.nextUrl.searchParams));
  const { scope, metrics } = await metricContext(ctx, orgId, companyId);
  const m = metrics.find((d) => d.key === decodeURIComponent(metricKey));
  if (!m) throw notFound("Metric");
  return { metric: metaOf(m), currency: scope.currency, data: await metricSeries(m, scope, resolveRange(range, from, to)) };
});
