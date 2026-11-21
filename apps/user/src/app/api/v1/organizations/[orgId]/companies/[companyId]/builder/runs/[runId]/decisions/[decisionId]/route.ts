import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { decide, decideInput } from "@/server/modules/builder/service";

type P = { orgId: string; companyId: string; runId: string; decisionId: string };

/** POST { action: "approve" | "revise", value?, feedback?, exclude? } — the founder's decision. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/decisions/:decisionId", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, runId, decisionId }) => decide(ctx, orgId, companyId, runId, decisionId, await body(req, decideInput)),
);
