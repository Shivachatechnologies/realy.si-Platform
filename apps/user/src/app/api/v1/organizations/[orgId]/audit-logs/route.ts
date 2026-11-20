import { route } from "@/server/core/http";
import { pageInput } from "@/server/core/pagination";
import { listAuditLogs } from "@/server/modules/audit/service";

export const GET = route<{ orgId: string }>({ auth: "required" }, async ({ req, ctx }, { orgId }) =>
  listAuditLogs(ctx, orgId, pageInput.parse(Object.fromEntries(req.nextUrl.searchParams))),
);
