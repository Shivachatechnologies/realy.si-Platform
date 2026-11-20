import { route } from "@/server/core/http";
import { getRun } from "@/server/modules/automation/service";

type P = { orgId: string; companyId: string; runId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, runId }) => getRun(ctx, orgId, companyId, runId));
