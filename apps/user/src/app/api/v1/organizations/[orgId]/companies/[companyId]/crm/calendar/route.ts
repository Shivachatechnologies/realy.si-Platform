import { route } from "@/server/core/http";
import { crmCalendar } from "@/server/modules/crm/activities";

type P = { orgId: string; companyId: string };

/** GET ?month=YYYY-MM&owner=me|<userId> */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) =>
  crmCalendar(ctx, orgId, companyId, req.nextUrl.searchParams.get("month") ?? "", { owner: req.nextUrl.searchParams.get("owner") ?? undefined }),
);
