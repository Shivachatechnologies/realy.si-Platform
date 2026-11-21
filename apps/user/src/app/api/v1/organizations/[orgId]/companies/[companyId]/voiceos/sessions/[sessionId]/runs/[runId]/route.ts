import { route } from "@/server/core/http";
import { followRun } from "@/server/modules/voiceos/service";

type P = { orgId: string; companyId: string; sessionId: string; runId: string };

/** GET — live state of a run started by voice: answer when complete, approvals waiting for a decision. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, sessionId, runId }) => followRun(ctx, orgId, companyId, sessionId, runId));
