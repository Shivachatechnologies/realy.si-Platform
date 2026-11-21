import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { cancelCommandRun } from "@/server/modules/guide/command";

type P = { orgId: string; companyId: string; sessionId: string; runId: string };

/** POST — cancel one command run (its running step tasks are cancelled, waiting steps skipped). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/guide/command/:sessionId/runs/:runId/cancel", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, sessionId, runId }) => cancelCommandRun(ctx, orgId, companyId, sessionId, runId),
);
