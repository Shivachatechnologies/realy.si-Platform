import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { invalid } from "@/server/core/errors";
import { executeObjective, executeObjectiveInput, objectiveExecutionStatus } from "@/server/modules/work/execution";

type P = { orgId: string; companyId: string };

/** GET ?objectiveId=…: execution status of every project carrying the objective. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const objectiveId = req.nextUrl.searchParams.get("objectiveId");
  if (!objectiveId) throw invalid("objectiveId is required");
  return objectiveExecutionStatus(ctx, orgId, companyId, objectiveId);
});

/** POST: turn an objective into a project with milestones and dependent tasks. */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/execution", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  executeObjective(ctx, orgId, companyId, await body(req, executeObjectiveInput)),
);
