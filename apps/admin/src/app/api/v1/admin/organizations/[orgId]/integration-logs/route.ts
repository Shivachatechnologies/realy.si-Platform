import { route } from "@/server/core/http";
import { adminIntegrationRequestLogs } from "@/server/modules/admin/org-integrations";

type P = { orgId: string };

/** The organization's integration request log (B34): ?companyId=&provider=&outcome=all|errors&cursor=&limit= */
export const GET = route<P>({ auth: "required", name: "GET /admin/organizations/:id/integration-logs" }, async ({ req, ctx }, { orgId }) =>
  adminIntegrationRequestLogs(ctx, orgId, Object.fromEntries(req.nextUrl.searchParams)),
);
