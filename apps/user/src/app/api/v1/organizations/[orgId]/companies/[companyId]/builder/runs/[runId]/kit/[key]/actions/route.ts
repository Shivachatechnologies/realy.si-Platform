import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { actionInput, runKitAction } from "@/server/modules/builder/kit-actions";

type P = { orgId: string; companyId: string; runId: string; key: string };

/** POST { action, value?, again? } — "Turn this into action": creates real records from the deliverable through each module's service. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/kit/:key/actions", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, runId, key }) => runKitAction(ctx, orgId, companyId, runId, key, await body(req, actionInput)),
);
