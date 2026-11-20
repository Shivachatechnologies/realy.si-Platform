import { route } from "@/server/core/http";
import { listApprovals } from "@/server/modules/approvals/service";

export const GET = route<{ orgId: string; companyId: string }>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({
  data: await listApprovals(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)),
}));
