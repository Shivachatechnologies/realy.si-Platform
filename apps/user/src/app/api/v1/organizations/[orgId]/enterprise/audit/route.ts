import { route } from "@/server/core/http";
import { parseAuditFilters, searchAudit } from "@/server/modules/enterprise/insights";

/** GET ?actor=&action=&resource=&category=&from=YYYY-MM-DD&to=YYYY-MM-DD&cursor=&limit= */
export const GET = route<{ orgId: string }>({ auth: "required" }, async ({ req, ctx }, { orgId }) =>
  searchAudit(ctx, orgId, parseAuditFilters(Object.fromEntries(req.nextUrl.searchParams))),
);
