import { route } from "@/server/core/http";
import { listWorkflowApprovals } from "@/server/modules/automation/service";

type P = { orgId: string; companyId: string };

/** GET ?status=PENDING|DECIDED */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({
  data: await listWorkflowApprovals(ctx, orgId, companyId, req.nextUrl.searchParams.get("status") === "DECIDED" ? "DECIDED" : "PENDING"),
}));
