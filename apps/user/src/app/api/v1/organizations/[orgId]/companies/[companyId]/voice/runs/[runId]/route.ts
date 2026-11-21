import { route } from "@/server/core/http";
import { getRun, runReport } from "@/server/modules/voice/runs";

type P = { orgId: string; companyId: string; runId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, runId }) => {
  const run = await getRun(ctx, orgId, companyId, runId);
  return { ...run, liveReport: await runReport(orgId, companyId, runId) };
});
