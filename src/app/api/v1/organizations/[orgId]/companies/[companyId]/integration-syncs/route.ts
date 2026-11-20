import { route } from "@/server/core/http";
import { listSyncRuns } from "@/server/modules/integrations/service";

type P = { orgId: string; companyId: string };

/** GET ?provider=&status=&cursor= */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const q = req.nextUrl.searchParams;
  return listSyncRuns(ctx, orgId, companyId, { provider: q.get("provider") ?? undefined, status: q.get("status") ?? undefined, cursor: q.get("cursor") ?? undefined });
});
