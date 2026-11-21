import { route } from "@/server/core/http";
import { computeCommissions, parseSalesRange } from "@/server/modules/crm/sales";

type P = { orgId: string; companyId: string };

/** GET ?from=&to=&owner=&pipeline= — computed commissions for deals won in the range. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) =>
  computeCommissions(ctx, orgId, companyId, parseSalesRange(Object.fromEntries(req.nextUrl.searchParams))),
);
