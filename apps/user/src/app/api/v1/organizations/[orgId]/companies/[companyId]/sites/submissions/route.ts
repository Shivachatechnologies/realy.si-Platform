import { route } from "@/server/core/http";
import { listSubmissions } from "@/server/modules/sites/forms";

type P = { orgId: string; companyId: string };

/** Form submissions inbox (?status=NEW|READ|ARCHIVED&page=). */
export const GET = route<P>({ auth: "required", name: "GET /organizations/:orgId/companies/:companyId/sites/submissions" }, async ({ req, ctx }, { orgId, companyId }) =>
  listSubmissions(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)),
);
