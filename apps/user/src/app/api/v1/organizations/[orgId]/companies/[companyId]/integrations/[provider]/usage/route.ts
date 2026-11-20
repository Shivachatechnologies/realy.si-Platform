import { route } from "@/server/core/http";
import { listUsage, usageSummary } from "@/server/modules/integrations/service";

type P = { orgId: string; companyId: string; provider: string };

/** A provider's metered usage (paged) plus 30-day totals. Query: operation, status, cursor. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, provider }) => {
  const q = req.nextUrl.searchParams;
  const [page, summary] = await Promise.all([
    listUsage(ctx, orgId, companyId, provider, { operation: q.get("operation") ?? undefined, status: q.get("status") ?? undefined, cursor: q.get("cursor") ?? undefined }),
    usageSummary(ctx, orgId, companyId, { provider }),
  ]);
  return { ...page, summary };
});
