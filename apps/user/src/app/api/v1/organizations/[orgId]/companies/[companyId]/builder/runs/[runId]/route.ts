import { route } from "@/server/core/http";
import { getRunView } from "@/server/modules/builder/service";

type P = { orgId: string; companyId: string; runId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, runId }) => {
  const v = await getRunView(ctx, orgId, companyId, runId);
  return { ...v, tasks: [...v.tasks.values()], docs: [...v.docs.values()] };
});
