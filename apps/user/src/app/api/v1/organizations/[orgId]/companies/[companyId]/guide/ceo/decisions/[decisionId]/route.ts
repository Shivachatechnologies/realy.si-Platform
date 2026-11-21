import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { decideCeoDecision, decisionInput } from "@/server/modules/guide/ceo";

type P = { orgId: string; companyId: string; decisionId: string };

/** POST — approve or dismiss a decision the AI CEO escalated (approving a delegation proposal starts the work). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/guide/ceo/decisions/:id", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, decisionId }) => decideCeoDecision(ctx, orgId, companyId, decisionId, await body(req, decisionInput)),
);
