import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { feedbackInput, reportAutonomyProblem } from "@/server/modules/workforce/autonomy-service";

type P = { orgId: string; companyId: string; actionId: string };

/** Report a problem with an auto-approved action (complaint, reversal, needed edits) — a trust signal. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/autonomy/actions/:actionId/feedback", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, actionId }) => reportAutonomyProblem(ctx, orgId, companyId, actionId, await body(req, feedbackInput)),
);
