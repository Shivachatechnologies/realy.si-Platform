import { route } from "@/server/core/http";
import { listRuns, parseRunFilters } from "@/server/modules/automation/service";

type P = { orgId: string; companyId: string };

/** GET ?status=&workflow=&cursor= */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listRuns(ctx, orgId, companyId, parseRunFilters(Object.fromEntries(req.nextUrl.searchParams))));
