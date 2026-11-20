import { notFound } from "@/server/core/errors";
import { route } from "@/server/core/http";
import { runOverview } from "@/server/modules/marketing/run";

type P = { orgId: string; companyId: string; runId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, runId }) => {
  const r = await runOverview(ctx, orgId, companyId, runId);
  if (!r) throw notFound("Marketing run");
  return r;
});
